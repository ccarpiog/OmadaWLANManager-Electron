# TP-Link cloud controllers (Account Level Open API)

Proposal from the user, 2026-10-07. Position: after the plan's remaining phases (after phase 20).
Suggested split: three high-risk phases (A main-side cloud account, B cloud controller session,
C renderer + docs).

## Why

The user's TP-Link cloud portal lists three Omada 6.3.0.45 controllers: "Omada red antigua (Proxmox)"
(the software controller this app already connects to directly) and two OC200 hardware controllers,
"OC200 Planta 3" and "OC200 Planta 4", on a separate network with Internet access only. VPNs into
that network are not possible. `docs/management-design.md` §7 dropped multi-controller support
because the controller-level cloud token path did not know local controllers. TP-Link's newer
**Account Level Open API** (beta) does reach them: it tunnels the documented Open API through Cloud
Access.

## User decisions (2026-10-07)

- **D5:** reach the remote controllers through the Account Level Open API.
- **D6: local + cloud.** The configured local controller keeps today's direct connection (internal
  API, TOFU pin, D1 moves). A cloud account adds the other controllers. One controller switcher
  lists them all; a cloud controller whose `omadacId` equals the local controller's is listed once,
  as local.
- **D7:** comes after phase 20, and extends the README and `docs/live-test-checklist.md` rather
  than rewriting them.
- **D4 still applies, extended:** no request to any `tplinkcloud.com` host from tests, smoke or
  probes. As of 2026-10-07 TP-Link has not enabled the portal's Open API page for the user's
  account, so nothing here can be live-tested: build against the documented contract and fixtures.

## API facts

Source: the "Open API Access Guide" at https://omada-northbound-docs-beta.tplinkcloud.com/ (raw
JSON: `/api/markdowns/account-level-access-guide/content.json`), read 2026-10-07. The first phase
copies the parts used into `docs/omada-cloud-openapi.md`.

- **Credential:** created in the cloud portal → On Premise Systems → **Open API** (route
  `#/cloudOpenApi`, shown only when TP-Link enables the account flag `showAccountOpenApi`).
  Settings: name, description, validity (30/90 days, half a year, one year, permanent),
  organizations (all or selected), access (full / view only). It yields a Client ID and Client
  Secret, and optionally an `AK-…` API key shown once (not used by the app).
- **Base URL by region:** APS `https://aps1-omada-northbound.tplinkcloud.com`, EUW
  `https://euw1-omada-northbound.tplinkcloud.com` (the user's), USE
  `https://use1-omada-northbound.tplinkcloud.com`. EUW is live: dummy credentials answer
  `{"errorCode":-52602,"msg":"This Open API Application has expired or does not exist."}`; a bad
  bearer on `/v1/organizations` answers HTTP 401 with `errorCode -44116`.
- **Token:** `POST {base}/authorize/account/token?type=get_tokens`, JSON body
  `{"client_id": …, "client_secret": …}` → `result.{accessToken, tokenType: "bearer",
  expiresIn: 7200, refreshToken}`. Refresh tokens last 14 days and are single-use
  (`?type=refresh&refresh_token=…`, same body).
- **Organizations:** `GET {base}/v1/organizations?page=1&pageSize=<1–100>[&searchKey=]`, header
  `Authorization: AccessToken=<token>` → `result.{totalRows, currentPage, currentSize, data[]}`,
  rows `{orgName, online, deviceId, omadacId, orgVersion, deviceType, serverHost}` (`deviceType`
  e.g. `SMB.OMADA.SOFTWARECONTROLLER`). Open API works only when `online`; controller types need
  `orgVersion` ≥ 6.2.0.
- **Controller calls:** `{serverHost}/v1/cloudaccess/{deviceId}` followed by the self-hosted path,
  e.g. `{serverHost}/v1/cloudaccess/{deviceId}/openapi/v1/{omadacId}/users?page=1&pageSize=10`,
  same header. The operations in `docs/omada-openapi-ops.md` therefore apply behind that prefix.
- **Rate limit:** 10 requests/s per credential; over it → `-7132`.

## Architecture (main process)

- **`CloudAccountClient`** (new, Electron-free, injected transport like `OpenApiClient`): token
  via `get_tokens`, renewed by re-running `get_tokens` before expiry and once on an auth error
  (never the single-use refresh token); the organization list walked to `totalRows` with a cap;
  one shared throttle per credential (≤ 5 requests/s across all sessions) that backs off on
  `-7132`; stable error codes.
- **`serverHost` allowlist:** used only when it is `https:` on the default port with hostname
  `aps1|euw1|use1-omada-northbound.tplinkcloud.com`; otherwise that organization is listed as
  unsupported. The token is never sent to any other host.
- **`OpenApiClient` route:** `local` (today's behavior; existing tests unchanged) or `cloud`
  (`{serverHost}/v1/cloudaccess/{deviceId}` prefix, token from `CloudAccountClient`). Existing
  operations and validators are reused.
- **Certificates:** cloud hosts get Chromium's normal verification in their own Electron session;
  no TOFU pin and no certificate dialog. The pinned local-controller session is untouched.
- **Open-API-only `ControllerSession`** for cloud controllers (no internal client):
  - Sites: `GET …/sites`.
  - APs with status, clients and current group (id and name): `GET …/sites/{siteId}/ap-groups/aps`
    (paged).
  - Groups, including empty ones, per-band capacity and SSID names: `GET …/ap-groups`.
  - Wi-Fi networks and the management writes: the phase 16–19 code, unchanged.
  - Version and group model from `orgVersion`; below 6.3 → listed but not connectable.
  - Capability checks §2.2 (4)–(5) compare internal with Open API data and do not apply here;
    management is on when the token works and the site is listed. A view-only credential's
    refusal shows the controller's code and message.
- **AP moves on cloud controllers** use the Open API (there is no internal API): per AP,
  `PATCH …/sites/{siteId}/aps/{apMac}/wlan-group` with `{"wlanGroupId": "<AP-group id>"}`. An AP
  counts as moved only when a re-read of `ap-groups/aps` shows it in the destination group;
  otherwise it is a failure with Retry (the 13b results flow). The local controller keeps the
  internal move.
- **`ConnectionManager` target:** `{kind: 'local'} | {kind: 'cloud', omadacId}`. Switching runs
  the same synchronous `invalidateControllerState()` as a URL change: in-flight connects, site
  choices, tokens and managed reads are superseded, stale replies dropped by session nonce.
- **Config** (new optional fields, validated like today; no schema break): `cloudRegion`
  (`aps|euw|use`, default `euw`), `cloudClientId`, `encryptedCloudClientSecret` (safeStorage only,
  with the management Client Secret's session-only fallback), `localOmadacId` (learned on a local
  connect, dropped with the URL), `activeController` (`'local'` or an omadacId), `cloudSites`
  (`{[omadacId]: siteId}`). Changing the region or the Client ID drops the stored secret;
  **Remove cloud access** deletes every cloud field and returns to local.

## Security

`docs/management-design.md` §3 applies. The cloud secret and tokens never reach the renderer, IPC
replies or logs; the redactor must cover `client_secret`, `AccessToken=` and `Bearer AK-`. IPC
carries `hasCloudSecret` / session-only flags only. New channels go through `ipc-guards.ts` and are
bound to the session nonce. The renderer gets a DTO `{omadacId, name, online, version, connectable,
reason}`; `deviceId` and `serverHost` stay in main.

## UI (es/en parity)

- **Settings:** a "TP-Link cloud (optional)" section with Region, Client ID, Client Secret,
  **Test cloud access** (token + organization list: the controllers found, and why any cannot be
  used), **Remove cloud access**, and a note on where the credential is created (full access is
  needed for changes).
- **Controller switcher** at the top of the sidebar, above the site switcher: the local controller
  first ("This network"), then cloud controllers by name with a "Cloud" tag; offline, below-6.3 or
  unsupported entries disabled with the reason. Disabled while a move or write is running.
  Switching resets the view state (selection, history, searches, managed caches) and loads the new
  controller with skeletons. The header shows the controller name.
- When the local controller is unreachable and the cloud lists the same omadacId online, the error
  state offers **Connect through TP-Link cloud**.
- Cloud controllers: Settings' certificate section says the certificate is verified normally;
  specific messages for rate limiting (`-7132`), an offline controller, and an expired or deleted
  credential (`-52602`, pointing at Settings).

## Unknowns → defaults (each goes into the live-test checklist)

- The account may never get the portal page → the cloud section stays optional and empty; the
  README states the requirement.
- `aps/{mac}/wlan-group` with an AP-group id through the tunnel on 6.3 → verify by re-read; a
  candidate fallback, not implemented: `PATCH ap-groups/{id}` with `{name, addApMacs}`.
- Whether the tunnel forwards v2 paths and every v1 path the app uses → each failure surfaces its
  own diagnostic; the checklist exercises each call.
- `ap-groups/aps` field coverage → a missing field shows "Unknown", never a guess.
- Codes for an expired, view-only or unselected-organization credential → known codes mapped,
  others shown as code + message.

## Suggested phases

- **A (high):** config fields and their persistence, `CloudAccountClient`, the `OpenApiClient`
  route, redactor additions, guarded IPC `cloud:test` / `cloud:controllers`, smoke-stub channels,
  `docs/omada-cloud-openapi.md`, fixture tests built from the guide's examples.
- **B (high):** the Open-API-only `ControllerSession` and `ConnectionManager` targets: data
  mapping, management on cloud controllers, Open API moves with verify-by-re-read; race tests
  (switch during a connect, a move, a managed read); `npm run tls-probe` still green.
- **C (high):** Settings cloud section, controller switcher, state reset, cloud error states, the
  "through TP-Link cloud" fallback, a smoke launch `[cloud]` (es + en) whose stub lists four
  organizations (the local duplicate hidden, one offline, one below 6.3, one connectable); README
  and a cloud section in `docs/live-test-checklist.md`.
