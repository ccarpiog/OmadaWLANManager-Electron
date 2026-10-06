// Minimal fake Omada controller for the TLS probe's end-to-end part
// (run-tls-probe.mjs): an HTTPS server on 127.0.0.1 presenting a given
// self-signed certificate and answering the internal-API (v2) calls the app
// makes, with the envelopes from tests/fixtures/controller/responses.json.
// It logs every HTTP request it receives (and the passwords of login POSTs),
// so the probe can prove that nothing — in particular no password — arrives
// before the certificate pin check passes. For the concurrency checks it can
// also serve the multi-site listing (setSites('multi')) and hold the response
// to one request until the probe releases it (hold()), which keeps a connect
// in flight at a chosen step.

import { readFileSync } from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const responses = JSON.parse(readFileSync(path.join(projectRoot, 'tests', 'fixtures', 'controller', 'responses.json'), 'utf8'));
const OMADAC_ID = responses.apiInfo.result.omadacId;
const SITE_ID = responses.sitesSingle.result.data[0].id;

/**
 * Picks the fixture envelope for one request.
 * @param {string} method - HTTP method.
 * @param {string} pathname - Request path (no query).
 * @param {'single' | 'multi'} sites - Which site listing to serve.
 * @returns {object | null} The envelope, or null for an unknown route (404).
 */
function route(method, pathname, sites) {
  const prefix = `/${OMADAC_ID}/api/v2`;
  if (method === 'GET' && pathname === '/api/info') {
    return responses.apiInfo;
  }
  if (method === 'POST' && pathname === `${prefix}/login`) {
    return responses.loginOk;
  }
  if (method === 'POST' && pathname === `${prefix}/logout`) {
    return responses.ok;
  }
  if (method === 'GET' && pathname === `${prefix}/sites`) {
    return sites === 'multi' ? responses.sitesMulti : responses.sitesSingle;
  }
  if (method === 'GET' && pathname === `${prefix}/sites/${SITE_ID}/devices`) {
    return responses.devices;
  }
  if (method === 'GET' && pathname === `${prefix}/sites/${SITE_ID}/setting/ssids`) {
    return responses.ssids;
  }
  return null;
} // End of function route()

/**
 * Starts the fake controller.
 * @param {{ key: Buffer; cert: Buffer }} pair - PEM key and certificate to present.
 * @param {number} [port] - Port to bind (0 = any free port).
 * @returns {Promise<{ port: number; requests: Array<{ method: string; path: string }>; loginPasswords: string[]; setSites: (kind: 'single' | 'multi') => void; hold: (method: string, pathSuffix: string) => { arrived: Promise<void>; release: () => void }; close: () => Promise<void> }>}
 */
export function startFakeController(pair, port = 0) {
  const requests = [];
  const loginPasswords = [];
  // Site listing served by GET .../sites (see setSites())
  let sites = 'single';
  // Armed holds: { method, pathSuffix, arrive, released, triggered }
  const holds = [];
  const server = https.createServer({ key: pair.key, cert: pair.cert }, (request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += String(chunk); });
    request.on('end', () => {
      const url = new URL(request.url, 'https://127.0.0.1');
      requests.push({ method: request.method, path: url.pathname });
      if (request.method === 'POST' && url.pathname.endsWith('/api/v2/login')) {
        try {
          loginPasswords.push(String(JSON.parse(body).password));
        } catch {
          loginPasswords.push('<unparseable body>');
        }
      }
      const envelope = route(request.method, url.pathname, sites);
      /**
       * Sends the reply, unless the client already dropped the connection
       * (e.g. the app closed the session while the reply was held).
       */
      const respond = () => {
        if (response.writableEnded || !response.socket || response.socket.destroyed) {
          return;
        }
        response.writeHead(envelope ? 200 : 404, { 'Content-Type': 'application/json', 'Set-Cookie': 'TPOMADA_SESSIONID=probe-session; Path=/; HttpOnly' });
        response.end(JSON.stringify(envelope ?? { errorCode: -1, msg: 'not found' }));
      };
      const hold = holds.find((candidate) => !candidate.triggered && candidate.method === request.method && url.pathname.endsWith(candidate.pathSuffix));
      if (hold) {
        hold.triggered = true;
        hold.arrive();
        hold.released.then(respond);
        return;
      }
      respond();
    });
  }); // End of the request handler
  server.keepAliveTimeout = 60000;
  server.on('tlsClientError', () => {
    // A client aborting the handshake (the app's verify proc rejected) is expected
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        requests,
        loginPasswords,
        /**
         * Selects the site listing GET .../sites serves from now on.
         * @param {'single' | 'multi'} kind - Single-site or multi-site fixture.
         */
        setSites: (kind) => {
          sites = kind;
        },
        /**
         * Arms a hold: the reply to the next request with this method whose
         * path ends with `pathSuffix` is withheld until release() is called.
         * @param {string} method - HTTP method.
         * @param {string} pathSuffix - Path suffix to match.
         * @returns {{ arrived: Promise<void>; release: () => void }} Resolves
         *   when the request arrived; release() sends the reply.
         */
        hold: (method, pathSuffix) => {
          let arrive;
          let release;
          const arrived = new Promise((resolveArrived) => { arrive = resolveArrived; });
          const released = new Promise((resolveReleased) => { release = resolveReleased; });
          holds.push({ method, pathSuffix, arrive, released, triggered: false, release });
          return { arrived, release };
        },
        /**
         * Releases every hold, then closes the server and every open connection.
         * @returns {Promise<void>}
         */
        close: () => new Promise((done) => {
          holds.forEach((hold) => hold.release());
          server.closeAllConnections();
          server.close(() => done());
        }),
      });
    });
  }); // End of the listen promise
} // End of function startFakeController()
