// Opt-in empirical TLS probe for certificate TOFU pinning (todo.md 4.4).
// NOT part of `npm test` or `npm run smoke`: run it with
//   ELECTRON_PATH=/path/to/Electron npm run tls-probe
// (`npm run tls-probe` builds first; or `node tests/tls-probe/run-tls-probe.mjs`
// after `npm run build`).
//
// It generates two self-signed certificates for 127.0.0.1 with the openssl CLI
// into a temp dir, launches the real Electron binary on probe-main.cjs (which
// installs the app's own verify proc from dist/main/cert-verify.js) with HOME
// on another temp dir, and checks:
//   (a) first use -> the request is rejected and the server never received an
//       HTTP request (so no credential could have been sent);
//   (b) after trusting -> an immediate retry succeeds (no stale cached rejection);
//   (c) the server switches to a different self-signed certificate -> rejected
//       as a mismatch, also on a different port of the same host;
//   (d) after a reset -> first use again (no stale cached acceptance or pooled
//       connection).
// Control steps (informational, not pass/fail) show what the same requests do
// WITHOUT a controller-session reset (ControllerTlsSessions.reset()), and that
// closing connections + re-installing the verify proc does not help, i.e. why
// the app switches to a fresh session partition instead.
//
// Part 2 (end to end) runs the REAL app — dist/main/index.js through
// app-main.cjs, with the real preload and renderer, driven by Playwright —
// against a local fake controller (fake-controller.mjs) and checks the same
// guarantees through the UI and the real IPC handlers: the first-use dialog
// appears before ANY HTTP request (so before the login POST), trusting
// connects, a reset while connected leads to a first use again, a certificate
// swap shows the "certificate changed" dialog, and the main process enforces
// the URL-scoped credentials and the trust-nonce checks. Adversarial
// concurrency checks then drive the real IPC handlers directly (the fake
// controller holds a reply to keep a connect in flight): a certificate reset
// or a controller URL change while a connect is in flight, a reset while
// connected without the renderer disconnecting first, and a URL change while a
// multi-site selection is pending — main alone must refuse every stale
// completion, install nothing and persist nothing for the old state.
// Only 127.0.0.1 is contacted; no controller, no ~/.omada-wlan-manager/ (HOME
// is a temp dir; the macOS Keychain is not used, see app-main.cjs).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { startFakeController } from './fake-controller.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROBE_MAIN = path.join(projectRoot, 'tests', 'tls-probe', 'probe-main.cjs');
const APP_MAIN = path.join(projectRoot, 'tests', 'tls-probe', 'app-main.cjs');
const RUN_TIMEOUT_MS = 120000;
const WAIT_MS = 15000;
const PROBE_PASSWORD = 'tls-probe-password';

const results = [];
const tempDirs = [];

/**
 * Records and prints one check.
 * @param {string} name - Check name.
 * @param {boolean} ok - Whether it passed.
 * @param {unknown} detail - Printed on failure.
 */
function record(name, ok, detail) {
  results.push({ name, ok });
  const suffix = ok ? '' : `\n        -> ${JSON.stringify(detail)}`;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${suffix}`);
}

/**
 * Prints an error and exits (setup problems).
 * @param {string} message - What went wrong.
 */
function fail(message) {
  console.error(`\nTLS probe cannot run: ${message}\n`);
  process.exit(1);
}

/**
 * Resolves the Electron executable from ELECTRON_PATH (binary or .app bundle).
 * @returns {string} The binary path.
 */
function resolveElectron() {
  let binary = process.env.ELECTRON_PATH;
  if (!binary) {
    fail('set ELECTRON_PATH to an Electron executable or .app bundle (Dropbox breaks node_modules/electron/dist)');
  }
  if (binary.endsWith('.app') && existsSync(binary) && statSync(binary).isDirectory()) {
    binary = path.join(binary, 'Contents', 'MacOS', 'Electron');
  }
  if (!existsSync(binary)) {
    fail(`ELECTRON_PATH points at a missing file: ${binary}`);
  }
  return binary;
} // End of function resolveElectron()

/**
 * Generates one self-signed certificate for 127.0.0.1 with the openssl CLI
 * and returns its SHA-256 fingerprint as openssl computes it (an independent
 * check of the app's own fingerprint computation).
 * @param {string} dir - Output directory.
 * @param {'A' | 'B'} name - Certificate name.
 * @returns {string} The colon-separated uppercase hex fingerprint.
 */
function generateCertificate(dir, name) {
  const key = path.join(dir, `key${name}.pem`);
  const cert = path.join(dir, `cert${name}.pem`);
  const created = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-noenc', '-keyout', key, '-out', cert, '-days', '7',
    '-subj', `/CN=omada-tls-probe-${name}`, '-addext', 'subjectAltName=IP:127.0.0.1',
  ], { encoding: 'utf8' });
  if (created.status !== 0) {
    fail(`openssl req failed for certificate ${name}: ${created.stderr}`);
  }
  const fingerprint = spawnSync('openssl', ['x509', '-in', cert, '-noout', '-fingerprint', '-sha256'], { encoding: 'utf8' });
  const match = /=([0-9A-F:]+)\s*$/.exec(fingerprint.stdout || '');
  if (fingerprint.status !== 0 || !match) {
    fail(`openssl x509 -fingerprint failed for certificate ${name}: ${fingerprint.stderr}`);
  }
  return match[1];
} // End of function generateCertificate()

/**
 * Launches Electron on probe-main.cjs and collects its PROBE lines.
 * @param {string} binary - Electron executable.
 * @param {string} certDir - Directory with the generated certificates.
 * @returns {Promise<{ steps: Record<string, object>; done: boolean; output: string; code: number | null }>}
 */
function runElectron(binary, certDir) {
  const home = mkdtempSync(path.join(os.tmpdir(), 'omada-tls-probe-home-'));
  tempDirs.push(home);
  const env = { ...process.env, HOME: home, USERPROFILE: home, OMADA_TLS_PROBE_CERTS: certDir };
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve) => {
    const child = spawn(binary, [PROBE_MAIN], { cwd: projectRoot, env });
    let output = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    const timer = setTimeout(() => child.kill('SIGKILL'), RUN_TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      const steps = {};
      for (const line of output.split('\n')) {
        if (line.startsWith('PROBE {')) {
          const step = JSON.parse(line.slice('PROBE '.length));
          steps[step.step] = step;
        }
      }
      resolve({ steps, done: output.includes('PROBE_DONE'), output, code });
    });
  }); // End of the child-process promise
} // End of function runElectron()

/**
 * Short human-readable summary of a step outcome.
 * @param {object | undefined} step - The step data.
 * @returns {string} The summary.
 */
function describe(step) {
  if (!step) {
    return 'missing';
  }
  const verdict = step.ok ? `HTTP ${step.status} (accepted)` : `rejected (${step.error})`;
  const rejections = step.newRejections.map((rejection) => rejection.kind).join(', ') || 'none';
  return `${verdict}; verify-proc rejections: ${rejections}; server TLS connections: ${step.serverTlsConnections}, HTTP requests: ${step.serverHttpRequests}`;
}

/**
 * True when a step was rejected with exactly one rejection of the given kind
 * and fingerprints, and the server received no HTTP request.
 * @param {object | undefined} step - The step data.
 * @param {'first-use' | 'mismatch'} kind - Expected rejection kind.
 * @param {string} fingerprint - Expected presented fingerprint.
 * @param {string} [pinned] - Expected pinned fingerprint (mismatch).
 * @returns {boolean} The verdict.
 */
function isPinRejection(step, kind, fingerprint, pinned) {
  return Boolean(step) && step.ok === false && step.serverHttpRequests === 0 &&
    step.newRejections.length === 1 && step.newRejections[0].kind === kind &&
    step.newRejections[0].fingerprint === fingerprint && step.newRejections[0].hostname === '127.0.0.1' &&
    (pinned === undefined || step.newRejections[0].pinnedFingerprint === pinned);
} // End of function isPinRejection()

/**
 * Runs one named end-to-end check; a thrown error (e.g. a wait timeout) is a
 * failure.
 * @param {string} name - Check name.
 * @param {() => Promise<{ ok: boolean; detail?: unknown }>} body - The check body.
 * @returns {Promise<void>}
 */
async function check(name, body) {
  try {
    const outcome = await body();
    record(name, outcome.ok, outcome.detail);
  } catch (error) {
    record(name, false, String(error && error.message ? error.message : error).split('\n')[0]);
  }
}

/**
 * Builds a verdict object.
 * @param {unknown} ok - Truthy when the check passed.
 * @param {unknown} detail - Diagnostic detail printed on failure.
 * @returns {{ ok: boolean; detail: unknown }} The verdict.
 */
function verdict(ok, detail) {
  return { ok: Boolean(ok), detail };
}

/**
 * Part 2: the real app against a local fake controller (see the header).
 * @param {string} binary - Electron executable.
 * @param {string} certDir - Directory with the generated certificates.
 * @param {string} fingerprintA - openssl fingerprint of certificate A.
 * @param {string} fingerprintB - openssl fingerprint of certificate B.
 * @returns {Promise<void>}
 */
async function runEndToEnd(binary, certDir, fingerprintA, fingerprintB) {
  /**
   * Reads one generated key pair.
   * @param {'A' | 'B'} name - Certificate name.
   * @returns {{ key: Buffer; cert: Buffer }} The PEM key and certificate.
   */
  const pairOf = (name) => ({ key: readFileSync(path.join(certDir, `key${name}.pem`)), cert: readFileSync(path.join(certDir, `cert${name}.pem`)) });
  let controller = await startFakeController(pairOf('A'));
  const port = controller.port;
  const url = `https://127.0.0.1:${port}`;
  const host = `127.0.0.1:${port}`;

  // Throwaway HOME with a stored config pointing at the fake controller
  const home = mkdtempSync(path.join(os.tmpdir(), 'omada-tls-probe-e2e-home-'));
  tempDirs.push(home);
  const configDir = path.join(home, '.omada-wlan-manager');
  const configFile = path.join(configDir, 'config.json');
  mkdirSync(configDir, { mode: 0o700 });
  writeFileSync(configFile, JSON.stringify({ url, username: 'probe', language: 'en', password: PROBE_PASSWORD }), { mode: 0o600 });
  /** @returns {object} The config file as currently on disk. */
  const readConfig = () => JSON.parse(readFileSync(configFile, 'utf8'));

  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: binary, args: [APP_MAIN], env, cwd: projectRoot, timeout: 30000 });
  const mainOutput = [];
  app.process().stdout?.on('data', (chunk) => mainOutput.push(String(chunk)));
  app.process().stderr?.on('data', (chunk) => mainOutput.push(String(chunk)));
  const rendererErrors = [];

  try {
    const page = await app.firstWindow();
    page.on('console', (message) => {
      if (message.type() === 'error') {
        rendererErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => rendererErrors.push(String(error)));

    /** @returns {Promise<object>} The certificate modal's visible content. */
    const readModal = () => page.evaluate(() => {
      const values = Array.from(document.querySelectorAll('#certDetails dd')).map((element) => element.textContent);
      return {
        title: document.getElementById('certModalHeading')?.textContent || '',
        values,
        confirmShown: !document.getElementById('confirmCertBtn')?.hidden,
      };
    });
    /** @returns {Promise<void>} Resolves when the certificate modal is open. */
    const waitForModal = () => page.waitForSelector('#certModal.visible', { timeout: WAIT_MS });
    /**
     * Waits until the status bar shows the given text.
     * @param {string} text - Expected status text.
     * @returns {Promise<void>}
     */
    const waitForStatus = (text) => page.waitForFunction((expected) => document.getElementById('statusText')?.textContent === expected, text, { timeout: WAIT_MS });
    /** @returns {Promise<void>} Resolves when the AP list has rows. */
    const waitForAps = () => page.waitForFunction(() => document.querySelectorAll('#apList .list-item').length > 0, null, { timeout: WAIT_MS });

    await check('[e2e] startup auto-connect: first-use dialog shows the controller host and certificate A\'s openssl fingerprint; the controller received NO HTTP request (no login POST)', async () => {
      await waitForModal();
      const modal = await readModal();
      return verdict(
        modal.title === 'Verify the controller certificate' && modal.values[0] === host && modal.values[1] === fingerprintA &&
        modal.confirmShown && controller.requests.length === 0 && controller.loginPasswords.length === 0,
        { modal, requests: controller.requests }
      );
    });

    await check('[e2e] Cancel, then Connect again: the first-use dialog comes back (no cached rejection swallows it), still no HTTP request', async () => {
      await page.click('#cancelCertBtn');
      await waitForStatus('Disconnected');
      await page.click('#connectBtn');
      await waitForModal();
      const modal = await readModal();
      return verdict(modal.values[1] === fingerprintA && controller.requests.length === 0, { modal, requests: controller.requests });
    });

    await check('[e2e] "Trust and connect": connected with lists; the first request is /api/info, exactly one login POST carries the configured password, and the pin is persisted', async () => {
      await page.click('#confirmCertBtn');
      await waitForStatus(host);
      await waitForAps();
      const config = readConfig();
      return verdict(
        controller.requests[0]?.path === '/api/info' && controller.loginPasswords.length === 1 &&
        controller.loginPasswords[0] === PROBE_PASSWORD && config.certificatePin?.origin === url &&
        config.certificatePin?.sha256 === fingerprintA,
        { requests: controller.requests, logins: controller.loginPasswords.length, pin: config.certificatePin }
      );
    }); // End of check "[e2e] Trust and connect..."

    await check('[e2e] Settings reset while connected: disconnects, removes the pin from disk, and the next Connect is a first use again with no new HTTP request (no stale acceptance)', async () => {
      await page.click('#settingsBtn');
      await page.waitForSelector('#settingsModal.visible', { timeout: WAIT_MS });
      const shownPin = await page.textContent('#certPinValue');
      await page.click('#resetCertBtn');
      await page.click('#confirmCertResetBtn');
      await page.waitForFunction(() => document.getElementById('certPinValue')?.textContent === 'None', null, { timeout: WAIT_MS });
      await page.keyboard.press('Escape');
      await waitForStatus('Disconnected');
      const config = readConfig();
      const requestsBefore = controller.requests.length;
      await page.click('#connectBtn');
      await waitForModal();
      const modal = await readModal();
      return verdict(
        shownPin === fingerprintA && !('certificatePin' in config) && modal.title === 'Verify the controller certificate' &&
        modal.values[1] === fingerprintA && controller.requests.length === requestsBefore,
        { shownPin, config, modal, requestsBefore, requestsAfter: controller.requests.length }
      );
    }); // End of check "[e2e] Settings reset while connected..."

    await check('[e2e] trusting again reconnects and re-pins certificate A', async () => {
      await page.click('#confirmCertBtn');
      await waitForStatus(host);
      await waitForAps();
      return verdict(readConfig().certificatePin?.sha256 === fingerprintA, readConfig().certificatePin);
    });

    await check('[e2e] controller swaps to certificate B on the same port: "certificate changed" dialog (A trusted, B presented), no HTTP request reaches it, the app stays disconnected', async () => {
      await page.click('#connectBtn');
      await waitForStatus('Disconnected');
      await controller.close();
      controller = await startFakeController(pairOf('B'), port);
      await page.click('#connectBtn');
      await waitForModal();
      const modal = await readModal();
      await page.click('#cancelCertBtn');
      await page.waitForFunction(() => document.getElementById('connectBtn')?.disabled === false, null, { timeout: WAIT_MS });
      const status = await page.textContent('#statusText');
      return verdict(
        modal.title === 'Controller certificate changed' && modal.values[0] === host && modal.values[1] === fingerprintA &&
        modal.values[2] === fingerprintB && modal.confirmShown === false && controller.requests.length === 0 &&
        status === 'Certificate changed: connection refused' && readConfig().certificatePin?.sha256 === fingerprintA,
        { modal, status, requests: controller.requests }
      );
    }); // End of check "[e2e] controller swaps to certificate B..."

    await check('[e2e] main enforces URL-scoped credentials over IPC: a new URL without a password is refused (passwordRequired, file untouched); with one, the old password and the pin are dropped', async () => {
      const before = readFileSync(configFile, 'utf8');
      const otherUrl = `https://127.0.0.1:${port === 65535 ? port - 1 : port + 1}`;
      const refused = await page.evaluate((target) => window.omadaAPI.saveConfig({ url: target, username: 'probe', language: 'en' }), otherUrl);
      const untouched = readFileSync(configFile, 'utf8') === before;
      const accepted = await page.evaluate((target) => window.omadaAPI.saveConfig({ url: target, username: 'probe', language: 'en', password: 'other-password' }), otherUrl);
      const config = readConfig();
      const view = await page.evaluate(() => window.omadaAPI.loadConfig());
      return verdict(
        JSON.parse(before).certificatePin?.sha256 === fingerprintA && refused.success === false && refused.error === 'passwordRequired' &&
        untouched && accepted.success === true && config.url === otherUrl && config.password === 'other-password' &&
        !('certificatePin' in config) && !('siteId' in config) && view.pinnedFingerprint === null && view.hasPassword === true,
        { refused, untouched, accepted, config, view }
      );
    }); // End of check "[e2e] main enforces URL-scoped credentials..."

    await check('[e2e] CERT_TRUST refuses a forged nonce (trustUnavailable) and rejects a malformed one', async () => {
      const forged = await page.evaluate(() => window.omadaAPI.trustCertificate('0'.repeat(32)));
      const malformed = await page.evaluate(() => window.omadaAPI.trustCertificate('not-a-nonce').then(() => 'resolved', () => 'rejected'));
      return verdict(forged.success === false && forged.error === 'trustUnavailable' && malformed === 'rejected' && !('certificatePin' in readConfig()), { forged, malformed });
    });

    // ------------------------------------------------------------------------
    // Adversarial concurrency (phase 11 review blockers): the real IPC handlers
    // are called directly, so main must be correct without any renderer help
    // ------------------------------------------------------------------------
    const otherUrl = `https://127.0.0.1:${port === 65535 ? port - 1 : port + 1}`;
    /**
     * Polls a condition until it holds or WAIT_MS pass.
     * @param {() => boolean} predicate - The condition.
     * @returns {Promise<boolean>} Whether it held in time.
     */
    const eventually = async (predicate) => {
      const deadline = Date.now() + WAIT_MS;
      while (Date.now() < deadline) {
        if (predicate()) {
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return predicate();
    };
    /** @returns {number} Logout POSTs the fake controller received so far. */
    const logoutCount = () => controller.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/api/v2/logout')).length;
    /** @returns {Promise<string>} 'installed' when main serves controller data, else 'not connected'. */
    const installedState = () => page.evaluate(() => window.omadaAPI.getAccessPoints().then(() => 'installed', () => 'not connected'));
    /**
     * Saves a config pointing at `target` (with a password) over IPC.
     * @param {string} target - Controller URL.
     * @param {string} password - Password to send.
     * @returns {Promise<object>} The ConfigSaveResult.
     */
    const saveUrl = (target, password) => page.evaluate(
      ([saveTarget, savePassword]) => window.omadaAPI.saveConfig({ url: saveTarget, username: 'probe', language: 'en', password: savePassword }),
      [target, password]
    );
    /**
     * Pins the certificate the fake controller serves through the real IPC
     * flow: connect -> certificateUntrusted -> trustCertificate(nonce).
     * @returns {Promise<void>}
     */
    const trustThroughIpc = async () => {
      const first = await page.evaluate(() => window.omadaAPI.connect());
      if (first.error !== 'certificateUntrusted' || !first.trustNonce) {
        throw new Error(`expected a first-use result, got ${JSON.stringify(first)}`);
      }
      const trusted = await page.evaluate((nonce) => window.omadaAPI.trustCertificate(nonce), first.trustNonce);
      if (!trusted.success) {
        throw new Error(`trust failed: ${JSON.stringify(trusted)}`);
      }
    }; // End of helper trustThroughIpc()
    /** @returns {Promise<void>} Starts an IPC connect without awaiting it (kept on window). */
    const startConnect = () => page.evaluate(() => {
      window.__probeConnect = window.omadaAPI.connect();
    });
    /** @returns {Promise<object>} The result of the connect started by startConnect(). */
    const finishConnect = () => page.evaluate(() => window.__probeConnect);

    await check('[e2e] adversarial: CERT_RESET while an authenticated connect is still in flight (reply to the site listing held): the stale connect is refused (connectionSuperseded), nothing is installed, no pin or site id is persisted', async () => {
      const restored = await saveUrl(url, PROBE_PASSWORD);
      await trustThroughIpc();
      const hold = controller.hold('GET', '/api/v2/sites');
      const loginsBefore = controller.loginPasswords.length;
      await startConnect();
      await hold.arrived;
      const reset = await page.evaluate(() => window.omadaAPI.resetCertificate());
      hold.release();
      const result = await finishConnect();
      const installed = await installedState();
      const config = readConfig();
      return verdict(
        restored.success === true && controller.loginPasswords.length === loginsBefore + 1 &&
        reset.success === true && reset.connectionReset === true && result.success === false &&
        result.error === 'connectionSuperseded' && installed === 'not connected' &&
        !('certificatePin' in config) && !('siteId' in config),
        { restored, reset, result, installed, pin: config.certificatePin, siteId: config.siteId }
      );
    }); // End of check "[e2e] adversarial: CERT_RESET while an authenticated connect..."

    await check('[e2e] adversarial: CERT_RESET while connected, without the renderer disconnecting first: main detaches the controller (data calls refused), logs it out (a logout POST reaches the controller) and removes the pin', async () => {
      await trustThroughIpc();
      const connected = await page.evaluate(() => window.omadaAPI.connect());
      const before = await installedState();
      const logoutsBefore = logoutCount();
      const reset = await page.evaluate(() => window.omadaAPI.resetCertificate());
      const after = await installedState();
      const loggedOut = await eventually(() => logoutCount() === logoutsBefore + 1);
      return verdict(
        connected.success === true && before === 'installed' && reset.success === true && reset.connectionReset === true &&
        after === 'not connected' && loggedOut && !('certificatePin' in readConfig()),
        { connected, before, reset, after, logouts: logoutCount() - logoutsBefore }
      );
    }); // End of check "[e2e] adversarial: CERT_RESET while connected..."

    await check('[e2e] adversarial: controller URL change while an authenticated connect is still in flight: the stale completion is refused (connectionSuperseded), nothing is installed or persisted for the old controller, no further login reaches it', async () => {
      await trustThroughIpc();
      const hold = controller.hold('GET', '/api/v2/sites');
      await startConnect();
      await hold.arrived;
      const loginsBefore = controller.loginPasswords.length;
      const saved = await saveUrl(otherUrl, 'other-password');
      hold.release();
      const result = await finishConnect();
      const installed = await installedState();
      const config = readConfig();
      return verdict(
        saved.success === true && saved.connectionReset === true && result.success === false &&
        result.error === 'connectionSuperseded' && installed === 'not connected' && config.url === otherUrl &&
        !('siteId' in config) && !('certificatePin' in config) && controller.loginPasswords.length === loginsBefore,
        { saved, result, installed, url: config.url, siteId: config.siteId, pin: config.certificatePin }
      );
    }); // End of check "[e2e] adversarial: controller URL change while an authenticated connect..."

    await check('[e2e] adversarial: controller URL change while a multi-site selection is pending: OMADA_SELECT_SITE with the old nonce is refused (siteUnavailable), no site id is persisted, the parked controller is logged out', async () => {
      controller.setSites('multi');
      try {
        const restored = await saveUrl(url, PROBE_PASSWORD);
        await trustThroughIpc();
        const pending = await page.evaluate(() => window.omadaAPI.connect());
        const logoutsBefore = logoutCount();
        const saved = await saveUrl(otherUrl, 'other-password');
        const siteId = pending.sites?.[0]?.id ?? '';
        const selected = await page.evaluate(([site, nonce]) => window.omadaAPI.selectSite(site, nonce), [siteId, pending.selectionNonce]);
        const installed = await installedState();
        const loggedOut = await eventually(() => logoutCount() === logoutsBefore + 1);
        const config = readConfig();
        return verdict(
          restored.success === true && pending.needsSiteSelection === true && typeof pending.selectionNonce === 'string' &&
          saved.success === true && saved.connectionReset === true && selected.success === false &&
          selected.error === 'siteUnavailable' && installed === 'not connected' && loggedOut &&
          config.url === otherUrl && !('siteId' in config),
          { restored, pending, saved, selected, installed, logouts: logoutCount() - logoutsBefore, siteId: config.siteId }
        );
      } finally {
        controller.setSites('single');
      }
    }); // End of check "[e2e] adversarial: controller URL change while a multi-site selection..."

    await check('[e2e] zero renderer console errors or page errors', async () => verdict(rendererErrors.length === 0, rendererErrors));
  } finally {
    await app.close().catch(() => {});
    await controller.close();
    if (results.some((result) => !result.ok)) {
      console.log(`\n[e2e] main-process output:\n${mainOutput.join('').trim()}`);
    }
  }
} // End of function runEndToEnd()

/**
 * Entry point: certificates, launch, checks, summary, cleanup.
 * @returns {Promise<void>}
 */
async function main() {
  for (const file of ['dist/main/cert-verify.js', 'dist/main/cert-pinning.js']) {
    if (!existsSync(path.join(projectRoot, file))) {
      fail(`missing build output ${file}; run \`npm run build\` first (\`npm run tls-probe\` does it for you)`);
    }
  }
  const binary = resolveElectron();
  const certDir = mkdtempSync(path.join(os.tmpdir(), 'omada-tls-probe-certs-'));
  tempDirs.push(certDir);

  try {
    const fingerprintA = generateCertificate(certDir, 'A');
    const fingerprintB = generateCertificate(certDir, 'B');
    console.log(`certificate A: ${fingerprintA}\ncertificate B: ${fingerprintB}`);

    const run = await runElectron(binary, certDir);
    const { steps } = run;
    if (steps.setup) {
      console.log(`Electron ${steps.setup.electron} (Chromium ${steps.setup.chrome}), configured origin ${steps.setup.origin}\n`);
    }
    for (const id of Object.keys(steps).filter((key) => key !== 'setup')) {
      console.log(`  ${id}: ${describe(steps[id])}`);
    }
    console.log('');

    record('probe ran to completion', run.done && run.code === 0, { code: run.code, output: run.output.slice(-2000) });
    record('(a) first use: rejected in the TLS handshake, first-use recorded with the openssl fingerprint, server got no HTTP request',
      isPinRejection(steps['a-first-use'], 'first-use', fingerprintA), steps['a-first-use']);
    record('(a) a repeat after a controller-session reset runs the verify proc again (first-use recorded again, no HTTP request)',
      isPinRejection(steps['a-repeat-after-reset'], 'first-use', fingerprintA), steps['a-repeat-after-reset']);
    const retry = steps['b-retry-after-trust'];
    record('(b) after trusting: the immediate retry succeeds (HTTP 200, no rejection, request reached the server)',
      Boolean(retry) && retry.ok === true && retry.status === 200 && retry.newRejections.length === 0 && retry.serverHttpRequests === 1, retry);
    record('(c) server switched to certificate B on the same port: rejected as a mismatch, no HTTP request',
      isPinRejection(steps['c-mismatch-same-port'], 'mismatch', fingerprintB, fingerprintA), steps['c-mismatch-same-port']);
    record('(c) certificate B on a different port of the same host: rejected as a mismatch, no HTTP request',
      isPinRejection(steps['c-mismatch-other-port'], 'mismatch', fingerprintB, fingerprintA), steps['c-mismatch-other-port']);
    const beforeReset = steps['d-before-reset-accepted'];
    record('(d) precondition: certificate A restored and accepted (pooled connection + cached acceptance exist)',
      Boolean(beforeReset) && beforeReset.ok === true, beforeReset);
    record('(d) after reset: first use again (rejected, first-use recorded, server got no HTTP request)',
      isPinRejection(steps['d-after-reset'], 'first-use', fingerprintA), steps['d-after-reset']);

    console.log('\nPart 2: the real app (dist/main/index.js) against a local fake controller\n');
    await runEndToEnd(binary, certDir, fingerprintA, fingerprintB);
  } finally {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n${results.length - failed}/${results.length} TLS probe checks passed`);
  process.exitCode = failed > 0 ? 1 : 0;
} // End of function main()

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
