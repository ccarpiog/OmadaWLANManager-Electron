// The IPC surface (phase 20a; docs/management-design.md §3 "New IPC
// channels", docs/security-audit.md):
// - the trusted registrar (src/main/ipc-trust.ts): no handler body runs for an
//   untrusted sender, a failure crosses only as a redacted message with the
//   stored secrets and the call's own secrets scrubbed by value, a channel
//   cannot be registered twice;
// - structurally, src/main/index.ts (which imports Electron, so it is read as
//   text here): every IPC_CHANNELS channel is registered exactly once, through
//   the registrar, with the sender check; nothing goes through ipcMain
//   directly; every handler captures and refuses extra arguments;
// - structurally, src/main/preload.ts: it imports only `electron` at runtime,
//   exposes exactly the expected methods (plus `platform`), each invoking its
//   one channel, uses no other ipcRenderer API, and its local channel table
//   equals the shared one;
// - the arity guard requireNoExtraArguments().

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { requireNoExtraArguments } from '../../src/main/ipc-guards';
import { argumentSecrets, createTrustedIpcRegistrar, sanitizeIpcError, UNTRUSTED_SENDER_MESSAGE } from '../../src/main/ipc-trust';
import { REDACTED } from '../../src/main/redact';
import { IPC_CHANNELS } from '../../src/shared/types';

/**
 * Reads a main-process source without its full-line comments (`//`, `/*`,
 * ` *` lines), so prose that names an API is never mistaken for code.
 * @param {string} file - File name under src/main.
 * @returns {string} The code lines.
 */
function mainSourceCode(file: string): string {
  return readFileSync(path.join(process.cwd(), 'src', 'main', file), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n');
}

const INDEX_SOURCE = mainSourceCode('index.ts');
const PRELOAD_SOURCE = mainSourceCode('preload.ts');
const CHANNEL_KEYS = Object.keys(IPC_CHANNELS).sort();

/** A fake invoke event: only whether the sender is trusted. */
interface FakeEvent {
  trusted: boolean;
}

/**
 * A fake ipcMain recording the registered listeners.
 * @returns {{ ipc: { handle(channel: string, listener: (event: FakeEvent, ...args: unknown[]) => unknown): void }; listeners: Map<string, (event: FakeEvent, ...args: unknown[]) => unknown> }}
 *   The registry and its listeners.
 */
function fakeIpc(): {
  ipc: { handle(channel: string, listener: (event: FakeEvent, ...args: unknown[]) => unknown): void };
  listeners: Map<string, (event: FakeEvent, ...args: unknown[]) => unknown>;
} {
  const listeners = new Map<string, (event: FakeEvent, ...args: unknown[]) => unknown>();
  return { ipc: { handle: (channel, listener) => void listeners.set(channel, listener) }, listeners };
}

describe('the trusted IPC registrar (ipc-trust.ts)', () => {
  test('an untrusted sender is rejected with the fixed message before the handler runs; a trusted one gets the handler with its arguments', async () => {
    const { ipc, listeners } = fakeIpc();
    const calls: unknown[][] = [];
    const registrar = createTrustedIpcRegistrar<FakeEvent>(ipc, (event) => event.trusted, () => []);
    registrar.handle('test:one', (_event, ...args) => {
      calls.push(args);
      return 'answer';
    });
    const listener = listeners.get('test:one');
    assert.ok(listener);
    await assert.rejects(async () => listener({ trusted: false }, 'a'), { message: UNTRUSTED_SENDER_MESSAGE });
    assert.deepEqual(calls, [], 'the handler never ran for the untrusted sender');
    assert.equal(await listener({ trusted: true }, 'a', 2), 'answer');
    assert.deepEqual(calls, [['a', 2]]);
    assert.deepEqual(registrar.channels, ['test:one']);
  }); // End of test "an untrusted sender is rejected..."

  test('a channel registered twice throws', () => {
    const { ipc } = fakeIpc();
    const registrar = createTrustedIpcRegistrar<FakeEvent>(ipc, () => true, () => []);
    registrar.handle('test:dup', () => null);
    assert.throws(() => registrar.handle('test:dup', () => null), /registered twice/);
  });

  test('a failure crosses as a new Error with only the redacted message: keyed secrets, stored secrets and the call\'s own secrets scrubbed', async () => {
    const { ipc, listeners } = fakeIpc();
    const registrar = createTrustedIpcRegistrar<FakeEvent>(ipc, () => true, () => ['stored-pass-1', null, 'stored-secret-2']);
    const original = Object.assign(new Error('boom stored-pass-1 stored-secret-2 typed-key-3 client_secret=abc Authorization: Bearer tok'), { body: 'raw' });
    registrar.handle('test:fail', () => {
      throw original;
    });
    const listener = listeners.get('test:fail');
    assert.ok(listener);
    await assert.rejects(
      async () => listener({ trusted: true }, { sessionNonce: 'n', passphrase: 'typed-key-3' }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.notEqual(error, original, 'never the original object');
        assert.equal(error.message, `boom ${REDACTED} ${REDACTED} ${REDACTED} client_secret=${REDACTED} Authorization: ${REDACTED}`);
        assert.equal((error as unknown as Record<string, unknown>).body, undefined);
        return true;
      }
    );
  }); // End of test "a failure crosses as a new Error..."

  test('a throwing stored-secret source counts as none; a guard rejection keeps its fixed text; a non-Error throw is stringified', async () => {
    const { ipc, listeners } = fakeIpc();
    const registrar = createTrustedIpcRegistrar<FakeEvent>(ipc, () => true, () => {
      throw new Error('safeStorage unavailable');
    });
    registrar.handle('test:guard', (_event, ...extra) => {
      requireNoExtraArguments(extra);
      return 'ok';
    });
    registrar.handle('test:string', () => {
      throw 'plain password=hunter2';
    });
    await assert.rejects(async () => listeners.get('test:guard')?.({ trusted: true }, 'extra'), { message: 'IPC call rejected: unexpected arguments' });
    await assert.rejects(async () => listeners.get('test:string')?.({ trusted: true }), { message: `plain password=${REDACTED}` });
  }); // End of test "a throwing stored-secret source counts as none..."

  test('argumentSecrets() collects the string values of sensitive keys at any depth, nothing else', () => {
    assert.deepEqual(
      argumentSecrets([
        'free text',
        { sessionNonce: 'n', name: 'Casa', passphrase: 'p1', nested: { clientSecret: 's2', list: [{ password: 'p3' }] } },
        { securityKey: '', psk: 42, token: 't4' }
      ]),
      ['p1', 's2', 'p3', 't4']
    );
    assert.equal(sanitizeIpcError(new Error('x p1 y'), ['p1']).message, `x ${REDACTED} y`);
  }); // End of test "argumentSecrets()..."

  test('requireNoExtraArguments() accepts none and refuses any', () => {
    assert.doesNotThrow(() => requireNoExtraArguments([]));
    assert.throws(() => requireNoExtraArguments([undefined]), { message: 'IPC call rejected: unexpected arguments' });
  });
});

/**
 * Splits index.ts into its handler registrations: channel key → the text from
 * its `handleTrusted(` up to the next registration (or the end).
 * @returns {Array<{ key: string; text: string }>} The registrations, in order.
 */
function registrations(): Array<{ key: string; text: string }> {
  const pattern = /handleTrusted\(\s*IPC_CHANNELS\.(\w+)\s*,/g;
  const found: Array<{ key: string; start: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(INDEX_SOURCE)) !== null) {
    found.push({ key: match[1], start: match.index });
  }
  return found.map((entry, index) => ({ key: entry.key, text: INDEX_SOURCE.slice(entry.start, found[index + 1]?.start ?? INDEX_SOURCE.length) }));
}

describe('index.ts registers every channel through the trusted registrar (structural)', () => {
  test('nothing is registered on ipcMain directly; the registrar gets ipcMain and the sender check', () => {
    assert.equal(/\bipcMain\s*\./.test(INDEX_SOURCE), false, 'no ipcMain.handle / .on / .once / .handleOnce / .addListener call');
    assert.match(INDEX_SOURCE, /createTrustedIpcRegistrar<IpcMainInvokeEvent>\(ipcMain, isTrustedIpcSender, storedSecrets\)/);
    assert.equal((INDEX_SOURCE.match(/\bipcMain\b/g) ?? []).length, 2, 'ipcMain is only imported and handed to the registrar');
  });

  test('every IPC_CHANNELS channel is registered exactly once, and only those', () => {
    const keys = registrations().map((entry) => entry.key);
    assert.deepEqual([...keys].sort(), CHANNEL_KEYS);
    assert.equal(new Set(keys).size, keys.length, 'no channel twice');
    assert.equal((INDEX_SOURCE.match(/handleTrusted\(/g) ?? []).length, keys.length, 'no registration with another channel expression');
  });

  test('every handler captures its extra arguments and passes them to a guard that refuses them', () => {
    for (const { key, text } of registrations()) {
      const signature = text.split('\n')[0];
      assert.match(signature, /\.\.\.extra: unknown\[\]\)/, `${key} captures extra arguments`);
      const body = text.slice(signature.length);
      assert.match(
        body,
        /requireNoExtraArguments\(extra\)|requireSessionNonce\(\w+, extra\)|parse\w+Request\(payload, extra\)|if \(extra\.length > 0\)/,
        `${key} refuses extra arguments`
      );
    } // End of the loop over the registrations
  }); // End of test "every handler captures its extra arguments..."
});

/**
 * The text of the object preload.ts exposes as `omadaAPI`.
 * @returns {string} The object literal's text.
 */
function exposedObject(): string {
  const start = PRELOAD_SOURCE.indexOf("contextBridge.exposeInMainWorld('omadaAPI', {");
  const end = PRELOAD_SOURCE.indexOf('} satisfies OmadaAPI);');
  assert.ok(start >= 0 && end > start, 'the exposed object is found');
  return PRELOAD_SOURCE.slice(start, end);
}

// The bridge the renderer gets: method → the channel it invokes
const EXPECTED_BRIDGE: Record<string, keyof typeof IPC_CHANNELS> = {
  loadConfig: 'CONFIG_LOAD',
  saveConfig: 'CONFIG_SAVE',
  connect: 'OMADA_CONNECT',
  getAccessPoints: 'OMADA_GET_APS',
  getWlanGroups: 'OMADA_GET_WLANS',
  setApWlanGroup: 'OMADA_SET_WLAN',
  selectSite: 'OMADA_SELECT_SITE',
  disconnect: 'OMADA_DISCONNECT',
  trustCertificate: 'CERT_TRUST',
  resetCertificate: 'CERT_RESET',
  getManagementCapabilities: 'MANAGEMENT_CAPABILITIES',
  testManagementAccess: 'MANAGEMENT_TEST',
  getManagedApGroups: 'MANAGEMENT_AP_GROUPS',
  createApGroup: 'MANAGEMENT_AP_GROUP_CREATE',
  renameApGroup: 'MANAGEMENT_AP_GROUP_RENAME',
  deleteApGroup: 'MANAGEMENT_AP_GROUP_DELETE',
  getManagedNetworks: 'MANAGEMENT_NETWORKS',
  createNetwork: 'MANAGEMENT_NETWORK_CREATE',
  updateNetwork: 'MANAGEMENT_NETWORK_UPDATE',
  changeNetworkPassword: 'MANAGEMENT_NETWORK_PASSWORD',
  setNetworkEnabled: 'MANAGEMENT_NETWORK_ENABLE',
  deleteNetwork: 'MANAGEMENT_NETWORK_DELETE',
  updateNetworkBindings: 'MANAGEMENT_NETWORK_BINDINGS'
};

describe('preload.ts exposes only the expected bridge (structural)', () => {
  test('its only runtime import is electron; no require()', () => {
    const imports = PRELOAD_SOURCE.match(/^import\b[^;]*;/gms) ?? [];
    assert.ok(imports.length >= 1);
    for (const statement of imports) {
      if (!/^import type\b/.test(statement)) {
        assert.match(statement, /from 'electron';$/, statement);
      }
    }
    assert.equal(/\brequire\s*\(/.test(PRELOAD_SOURCE), false);
    assert.equal((PRELOAD_SOURCE.match(/exposeInMainWorld\(/g) ?? []).length, 1, 'one exposed object');
  }); // End of test "its only runtime import is electron..."

  test('exactly the expected members: `platform` and one method per channel, each invoking its channel', () => {
    const object = exposedObject();
    const members = [...object.matchAll(/^ {2}(\w+):/gm)].map((match) => match[1]);
    assert.deepEqual([...members].sort(), ['platform', ...Object.keys(EXPECTED_BRIDGE)].sort());
    for (const [method, channel] of Object.entries(EXPECTED_BRIDGE)) {
      const start = object.indexOf(`  ${method}: (`);
      const next = object.indexOf('\n  },', start);
      const body = object.slice(start, next);
      const invoked = [...body.matchAll(/ipcRenderer\.invoke\(IPC_CHANNELS\.(\w+)/g)].map((match) => match[1]);
      assert.deepEqual(invoked, [channel], method);
    } // End of the loop over the expected bridge methods
    assert.deepEqual([...new Set(Object.values(EXPECTED_BRIDGE))].sort(), CHANNEL_KEYS, 'every channel has its method');
  }); // End of test "exactly the expected members..."

  test('no other ipcRenderer API is used, and ipcRenderer itself is never exposed', () => {
    const uses = [...PRELOAD_SOURCE.matchAll(/ipcRenderer\s*\.\s*(\w+)/g)].map((match) => match[1]);
    assert.deepEqual([...new Set(uses)], ['invoke']);
    assert.equal(/\bipcRenderer\b(?!\s*\.)/.test(exposedObject()), false, 'ipcRenderer only as ipcRenderer.invoke(…)');
  });

  test('the local channel table equals the shared IPC_CHANNELS', () => {
    const table = PRELOAD_SOURCE.slice(PRELOAD_SOURCE.indexOf('const IPC_CHANNELS'), PRELOAD_SOURCE.indexOf('};', PRELOAD_SOURCE.indexOf('const IPC_CHANNELS')));
    const local = Object.fromEntries([...table.matchAll(/^ {2}(\w+): '([^']+)'/gm)].map((match) => [match[1], match[2]]));
    assert.deepEqual(local, { ...IPC_CHANNELS });
  });
});
