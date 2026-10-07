# TP-Link cloud controllers — the Account Level Open API contract the app follows

Inbox item I-1 (spec: `autoclaude/processed/10-tplink-cloud-controllers.md`, user decisions D5–D7). This file is the
contract the main-process code of phases I-1a (`src/main/cloud-*.ts`, the `OpenApiClient` cloud route), I-1b1 (the
cloud controller session, §12) and I-1b2b1 (the connection targets, §13) follows. Every
detail marked **UNVERIFIED** is taken from the documentation only and is a live-test item: §11 lists them, and
`docs/live-test-checklist.md` Part C checks them.

## 1. Sources and status

- TP-Link's public "Open API Access Guide", account-level part, read 2026-10-07 from the documentation site
  (`https://omada-northbound-docs-beta.tplinkcloud.com/api/markdowns/account-level-access-guide/content.json`). The
  examples below are copied from it. The app never fetches the guide: it was read once by hand.
- Two live answers recorded by the user on 2026-10-07 (EUW, dummy credentials): `get_tokens` answered
  `{"errorCode":-52602,"msg":"This Open API Application has expired or does not exist."}`, and a bad bearer on
  `/v1/organizations` answered HTTP 401 with `errorCode -44116`.
- Nothing else is live-verified. As of 2026-10-07 TP-Link has not enabled the portal's Open API page for the user's
  account, so no real credential exists. Invariant D4 (extended): no test, smoke run or probe contacts any
  `tplinkcloud.com` API host; the unit tests serve these examples through a fake transport.

## 2. Credential creation

- Cloud portal → On Premise Systems → **Open API** (route `#/cloudOpenApi`). The page shows only when TP-Link enables
  the account flag `showAccountOpenApi`.
- Settings: name, description, validity (30 / 90 days, half a year, one year, permanent), organizations (all or
  selected), access (full / view only). The guide calls it "Credential" from 6.4 on (before: "Application").
- It yields a **Client ID** and a **Client Secret** (client-credentials mode, the one the app uses) and, optionally,
  an `AK-…` API key shown once. The app does not use API keys; the redactor removes them anyway.
- **UNVERIFIED:** what a view-only credential, or one whose organization list leaves a controller out, answers for a
  write or for that controller (spec: show the code and message).

## 3. Regions and base URLs

| Region (`cloudRegion`) | Account-level base URL |
|---|---|
| `aps` | `https://aps1-omada-northbound.tplinkcloud.com` |
| `euw` (default; the user's) | `https://euw1-omada-northbound.tplinkcloud.com` |
| `use` | `https://use1-omada-northbound.tplinkcloud.com` |

Code: `CLOUD_API_HOSTS`, `cloudBaseUrl()` in `src/main/cloud-hosts.ts`.

## 4. Access token

Request (the guide's example):

```
POST {base}/authorize/account/token?type=get_tokens
Content-Type: application/json

{"client_id": "185586e0df424f5ea938de13cba91e01", "client_secret": "767372a5258a4fc1a03c57f3d071fc35"}
```

Answer:

```json
{"errorCode": 0, "msg": "Open API Get Access Token successfully.",
 "result": {"accessToken": "a1-AT-AucoLyP4jpuCwriaOQpGvV2pdkG7YDDB", "tokenType": "bearer", "expiresIn": 7200,
            "refreshToken": "RT-gvPUG4oKc5SB6aDcsDfpE1KrohhjVZbY"}}
```

- Access tokens last 2 hours, refresh tokens 14 days. A refresh token is **single-use**
  (`?type=refresh&refresh_token=…`, same body, returns a new refresh token).
- **What the app does** (`CloudAccountClient`, `src/main/cloud-account-client.ts`): it runs `get_tokens` with the
  saved Client ID and secret; the request carries no Authorization header. `validateTokenResult()` (shared with the
  local Open API client) keeps only `accessToken` and its renewal time: the expiry minus 60 s. The token lives in a
  private field, never on disk, in IPC or in a log. It is renewed by running `get_tokens` **again**, either before
  it expires or once after an auth error. The refresh token is never sent and never kept: one lost or reused
  single-use token would otherwise lock the client out, and the client credentials give a new token anyway. All
  concurrent callers share one acquisition in flight.
- "Test cloud access" (`cloud:test`) always asks for a fresh token. The controller list (`cloud:controllers`) reuses
  a valid one.

## 5. Organization list

```
GET {base}/v1/organizations?page=1&pageSize=10[&searchKey=…]
Authorization: AccessToken=a1-AT-AucoLyP4jpuCwriaOQpGvV2pdkG7YDDB
```

`page` starts at 1, `pageSize` is 1–100, `searchKey` is a fuzzy match on `orgName` (not used). Answer:

```json
{"errorCode": 0, "msg": "OK", "result": {"totalRows": 1, "currentPage": 1, "currentSize": 10, "data": [
  {"orgName": "Omada Controller_9E81B9", "online": true, "deviceId": "7B069516D97677D0BCA8E643F334A1A3F182A1",
   "omadacId": "5ffc0460d2816b0d09b531cd27c106a8", "orgVersion": "6.2.0.9",
   "deviceType": "SMB.OMADA.SOFTWARECONTROLLER", "serverHost": "https://aps1-omada-northbound.tplinkcloud.com"}]}}
```

- `online`: the Open API works only while the organization is online. Controller types (`SMB.OMADA.*CONTROLLER`)
  need `orgVersion` 6.2.0 or later (the guide). This app needs 6.3 (its group model).
- `deviceId` goes into the cloudaccess path (§6), `omadacId` into the self-hosted path, and `serverHost` is the base
  of the controller calls.
- **What the app does:** it walks pages of 100 to `totalRows` (`walkPagedListing()`, shared with the local Open API
  listings), capped at 10 pages. Anything that leaves completeness unproven is fail-closed `truncated`: the cap, an
  empty or repeating page, or a changed `totalRows`. Rows are deduplicated by `omadacId`, and each row is validated
  strictly (`validateCloudOrganization()`, `src/main/cloud-account-model.ts`):
  - A row with no usable `omadacId` (`[A-Za-z0-9_-]{1,64}`, never `local`) refuses the whole list as
    `malformedResponse`.
  - Every other field is kept only when sane, otherwise it is unknown: `online` only as literal `true`, `deviceId`
    `[A-Za-z0-9_-]{1,128}`, `orgVersion` normalized like `/api/info`'s `controllerVer`, `deviceType` printable
    ASCII, `serverHost` through the allowlist (§8). A missing name falls back to the `omadacId`, and control and
    bidi characters are removed from names.
- **UNVERIFIED:** the OC200's `deviceType` value; whether `orgVersion` uses the 4-part form shown; whether
  `pageSize=100` is accepted; whether `totalRows` is reliable.

### The controller DTO and its reasons

The renderer gets `{omadacId, name, online, version, connectable, reason}` (`CloudController` in
`src/shared/types.ts`, built by `toCloudController()`). `deviceId`, `serverHost` and `deviceType` stay in main.
`connectable` is true exactly when `reason` is null. The reason is the first one that applies, permanent reasons
first, so `offline` means "would be connectable once online":

| `reason` | When |
|---|---|
| `notController` | `deviceType` is present but not `SMB.OMADA.*CONTROLLER` (case-insensitive) |
| `incompleteEntry` | no usable `deviceId`, or no `deviceType` |
| `unsupportedHost` | `serverHost` absent or not allowlisted (§8) |
| `versionUnknown` | `orgVersion` absent or not a dotted version (`6.3`, `6.3.0.45`) |
| `versionTooOld` | `orgVersion` below 6.3 (listed, not connectable) |
| `offline` | `online` is not `true` |

The controller switcher hides a cloud entry whose `omadacId` equals the local controller's (`localOmadacId`), and
Settings' Test result marks it "This network" (phases I-1c2a / I-1c2b, §10).

## 6. Controller calls through Cloud Access

```
GET {serverHost}/v1/cloudaccess/{deviceId}/openapi/v1/{omadacId}/users?page=1&pageSize=10
Authorization: AccessToken=a1-AT-RCio7FS9p46wSD7dM8CwNQA7ylcrmAcV
```

The template is `{serverHost}/v1/cloudaccess/{deviceId}/**`, followed by the self-hosted path, so the operations of
`docs/omada-openapi-ops.md` apply behind the prefix.

- **What the app does:** `new OpenApiClient({route: 'cloud', target, tokenProvider, throttle, transport})`:
  - `target` (`{omadacId, deviceId, serverOrigin}`) comes only from a connectable organization
    (`cloudControllerTarget()`), never from `/api/info` or the renderer.
  - The constructor refuses a `serverOrigin` that is not the normalized allowlisted origin, before any request.
  - `baseUrl` becomes `{serverOrigin}/v1/cloudaccess/{deviceId}`, and every existing operation and validator is
    reused unchanged. Example: `listSites()` →
    `GET https://aps1-omada-northbound.tplinkcloud.com/v1/cloudaccess/7B06…A1/openapi/v1/5ffc…a8/sites?page=1&pageSize=100`.
  - The token comes from the `CloudAccountClient` (`CloudTokenProvider`). On an auth error (HTTP 401, `-44112`,
    `-44113`, `-44116`) it asks for a renewed account token once and retries once; a second rejection is
    `tokenRejected`.
  - Cloud token failures map to `OpenApiError` codes: `credentialInvalid` becomes `invalidCredentials`, and the
    other codes keep their names.
  - The local route is unchanged: its own `/openapi/authorize/token`, the pinned controller session, no throttle.
  - On the cloud route only, a refusal (a non-zero `errorCode`, also inside a non-2xx answer) keeps TP-Link's message
    as `OpenApiError.controllerMessage`. It is redacted and scrubbed by value of the client's tokens and of the token
    provider's live secrets (the account's cloud Client Secret and tokens: `CloudTokenProvider.liveSecrets()`).
    Every scrubbed cloud-route text (that message, a transport or token failure) also loses the target's routing
    identifiers by value: the tunnel base URL, the `serverHost` origin and bare host, and the `deviceId`.
    `describeOpenApiFailure()` appends it to the codes, e.g. `apiError, errorCode -44121 (…)`. The local route never
    keeps controller text.
- The cloud controller session (§12, phase I-1b1) uses the cloud route for all its calls. `ConnectionManager`
  installs it for a cloud target (§13).
- **UNVERIFIED:** whether the tunnel forwards `/openapi/v2/…` paths (the SSID catalog and create) and every v1 path
  the app uses (spec: each failure shows its own diagnostic); which token-error codes the tunnel answers; whether
  `-44121` ("no permission to access this organization") is what a credential limited to other organizations gets.

## 7. Rate limit and the app's throttle

- TP-Link: 10 requests per second **per credential**. Over it, `errorCode -7132` ("Our server is receiving too many
  requests now. Please try again later.") or HTTP 429.
- **What the app does** (`CloudRequestThrottle`, `src/main/cloud-throttle.ts`): one throttle per saved credential,
  shared by every request sent with it. That covers its token requests, the organization list and every cloud-route
  Open API call.
  - At most **5 request starts per 1-second window**, half the documented limit, granted in call order.
  - A `-7132` or HTTP 429 answer holds every user of the credential back for 1 s, 2 s, 4 s, then 8 s. The request is
    retried at most 3 times, then fails as `rateLimited`. Any other answer resets the backoff.
- **UNVERIFIED:** whether the limit counts token requests, and whether the tunnel answers -7132 or 429.

## 8. The serverHost allowlist, the cloud session and certificates

- **Allowlist** (`allowlistedCloudOrigin()`, `src/main/cloud-hosts.ts`): a `serverHost` is used only when it:
  - is spelled `https://<host>` (optionally `:443` and a trailing slash);
  - parses as https on the default port with no userinfo, path, query or fragment;
  - has a hostname that is exactly `aps1-`, `euw1-` or `use1-omada-northbound.tplinkcloud.com` (any case; a trailing
    dot, look-alikes, other subdomains and percent-encoding are refused).

  Otherwise the organization is listed as `unsupportedHost`.
- **Transport guard** (`createAllowlistedCloudTransport()`, `src/main/cloud-transport.ts`): the cloud transport
  refuses every URL whose origin is not an allowlisted one before anything is sent, with fixed text. Redirects fail
  the request (`redirect: 'error'`, `createCloudNetTransport()` in `src/main/net-transport.ts`). The token can
  therefore never reach another host.
- **Session:** cloud requests use their own in-memory Electron partition, `omada-cloud-account`. It never carries a
  controller request, and the pinned controller session (`ControllerTlsSessions`) never carries a cloud request.
  - It keeps Chromium's normal certificate verification: `setCertificateVerifyProc(null)` is called explicitly, so
    there is no TOFU pin, no self-signed exception and no certificate dialog.
  - `decideCertificate()` (`src/main/cert-pinning.ts`) also never accepts a certificate for a cloud API host in the
    other sessions or in `certificate-error`, even if that host were the configured controller with a matching pin.
- **Proof:** `npm run tls-probe` step (e). A controller session accepts a self-signed 127.0.0.1 certificate pinned
  for its origin, but the cloud session rejects that same certificate (`net::ERR_CERT_AUTHORITY_INVALID`). The
  verify proc never runs on the cloud session, and the server sees no HTTP request. The cloud transport refuses the
  127.0.0.1 origin before any TLS connection. No test-only allowlist override exists: the probe drives the session
  directly.

## 9. Status and error codes

HTTP status codes in the guide: 400, 401, 403, 413 / 417 (request size), 429 (rate limit), 500.

| errorCode | Guide text | App code |
|---|---|---|
| -52602 | "This Open API Application has expired or does not exist." (live answer, not in the guide's table) | `credentialInvalid` |
| -90106 | The Client Id Or Client Secret is Invalid | `credentialInvalid` |
| -90112 | This Open API Application has expired or does not exist | `credentialInvalid` |
| -90113 | This Open API Application has been disabled | `credentialInvalid` |
| -44116 | Open API authorized failed, please check whether the input parameters are legal | token request: `credentialInvalid`; a call: token rejected (re-acquire once) |
| -44112 / -44113 | access token expired / invalid | token rejected (re-acquire once, then `tokenRejected`) |
| -7132 | rate limit | backoff and retry, then `rateLimited` |
| -90114 | exceeded the maximum allowed authentications | `apiError` (code plus redacted message) |
| -44121 | no permission to access this organization | `apiError` |
| -44114, -52603, -1001, others | refresh token expired, invalid token operation, invalid parameters, … | `apiError` |

Other outcomes:
- HTTP 401 / 403 on `get_tokens` is `credentialInvalid`, HTTP 401 on a call is a token rejection, any other non-2xx
  status is `httpError`.
- A transport timeout is `timeout`, any other failure (or a refused origin) is `networkError`.
- Invalid JSON, no `errorCode` or an unexpected shape is `malformedResponse`.
- A client replaced or closed while a call ran (the credentials were saved or removed) is `superseded`.
- Diagnostics are codes only, for example `credentialInvalid, errorCode -52602` or `httpError, HTTP 503`. Only for
  `apiError` do they add TP-Link's message, redacted and with the live secret and tokens scrubbed by value.
- **UNVERIFIED:** which of these codes `get_tokens` really answers (only -52602 was seen); what an expired, deleted,
  disabled or view-only credential answers on each call.

## 10. Secrets, config and IPC

- **Config** (`src/main/config-model.ts`, `config.ts`; optional fields, no schema break; malformed values are dropped
  on load):
  - `cloudRegion` (default `euw`) and `cloudClientId` (the management Client ID's format) are stored in plain text.
  - `encryptedCloudClientSecret` is a safeStorage blob only. Without secure storage the secret is session-only, the
    management Client Secret's fallback, and is never plaintext on disk.
  - `localOmadacId` is learned on a successful local connect and dropped when the controller URL changes (§13).
  - `activeController` is `'local'` (also when absent) or an `omadacId`; a target switch persists it (§13).
  - `cloudSites` maps `omadacId` to a site id; malformed entries are dropped, at most 64 are kept (a new choice goes
    last and the oldest goes first, §13).
- **Save rules:**
  - The cloud account is not tied to the controller URL, so a URL change keeps it.
  - A different region or cloud Client ID drops the stored secret: a typed one must come with it, otherwise
    `cloudClientSecretRequired`.
  - A typed secret without a Client ID is `cloudClientIdRequired`; an implausible Client ID is
    `invalidCloudClientId`.
- **Remove cloud access** is an explicit flag on the existing save path: `removeCloudAccess: true` in
  `config:save`, sent alone like `removeManagementAccess`. It deletes the region, the Client ID, the blob, the
  session-only secret, `cloudSites` and `activeController`, so the local controller is active again.
  `localOmadacId` belongs to the configured controller and stays.
- **No local controller (cloud-only, phase I-1c2a):** a save with `''` as URL and username and no password, while no
  local controller is stored, keeps the cloud fields only (`isCloudOnlySave()` / `applyCloudOnlySave()` in
  `config-model.ts`; the shape guard `isValidConfigSavePayload()` in `ipc-guards.ts` accepts that shape whole and still
  refuses a partial local section). It must remove cloud access or leave a cloud Client ID stored, else `invalidUrl` (the
  empty form, as before). The management Client ID / Client Secret belong to a local controller: either one is refused
  with `managementNeedsController`. The renderer mirrors the rule (`isCloudOnlyForm()`, `planCloudOnlySave()` in
  `src/renderer/cloud-form.ts`) and does not auto-connect after such a save.
- **What the renderer sees:** `RendererConfig.cloudAccess` and `ConfigSaveResult.cloudAccess` are
  `{region, clientId, hasCloudSecret, cloudSecretSessionOnly, canPersistCloudSecret, activeController}`, never the
  secret.
- **Cache invalidation:** a save that changes or removes the cloud credential drops the cloud client and its tokens
  in the same synchronous step as the write, before the save awaits any controller transition
  (`CloudAccessService.invalidate()`). On load, a region or cloud Client ID that is present but invalid drops the
  whole credential (region, Client ID, blob), so a secret is never rebound to the default region's endpoint.
- **IPC** (`docs/security-audit.md` §1): `cloud:test` and `cloud:controllers` (preload: `testCloudAccess()`,
  `getCloudControllers()`).
  - Both go through `handleTrusted()` and take **no argument** (`requireNoExtraArguments`), so the renderer can
    supply no host, `deviceId`, `serverHost` or URL.
  - They use the **saved** credentials only. With nothing saved they answer `notConfigured`. A form with unsaved
    cloud edits is refused by the renderer ("save first", I-1c), as "Test management access" does.
  - **No session nonce:** the nonce identifies a local controller session, which a cloud call does not have. A cloud
    call must work while disconnected from, or unable to reach, the local controller; it reads only the account and
    targets no controller. Stale replies are refused in main instead: a reply whose credentials were saved, removed
    or replaced meanwhile answers `superseded`.
  - Replies are the DTOs above or a stable code with a codes-only diagnostic. A success also carries the stored
    `localOmadacId` (phase I-1c2a) when one is stored: the renderer lists the organization with that omadacId once, as
    the local controller (Settings' Test result marks it "This network"; the switcher hides it). It never enters a
    diagnostic.
- **Redaction:** `src/main/redact.ts` covers:
  - `client_secret` / `clientSecret` in any casing and separator;
  - `AccessToken=…`, `Bearer AK-…`;
  - the `accessToken`, `refreshToken` and `refresh_token` keys and query parameters;
  - bare TP-Link token shapes (`AT-…`, `a1-AT-…`, `RT-…`, `AK-…` with 16+ alphanumerics after the prefix).

  The saved cloud secret and the live account tokens are added to the IPC registrar's stored secrets
  (`storedSecrets()` in `index.ts`), so free text is scrubbed of them by value too.

## 11. Unverified behaviors (live-test checklist items)

Each item is checked by `docs/live-test-checklist.md` Part C (its cross-reference rows `C11-1` to `C11-12`).

1. The portal's Open API page and credential creation (account flag `showAccountOpenApi`), and full versus view-only
   access.
2. `get_tokens` on each region with a real credential: the answer's shape, `expiresIn`, and the codes for a wrong,
   expired, deleted or disabled credential (only `-52602` was seen).
3. `/v1/organizations`: `pageSize=100`, `totalRows`, the OC200's `deviceType`, the `orgVersion` format, `online` for
   a powered-off OC200, and what `serverHost` the EUW account's organizations report.
4. A bad or expired token on `/v1/organizations` (HTTP 401 and `-44116` seen) and through the tunnel.
5. The rate limit: whether token requests count, `-7132` versus HTTP 429, and the tunnel's answer.
6. The tunnel: every v1 path the app uses, `/openapi/v2/…` paths (SSID catalog, create), write calls with a full and
   a view-only credential, and `-44121` for an organization outside the credential.
7. Whether the cloud's TLS certificates verify normally in Electron's network stack (expected: public CA).
8. `GET …/sites/{siteId}/ap-groups/aps` through the tunnel (§12): the fields it really returns (the `mac` form,
   `apGroupId`, `apGroupName`, `statusCategory`, `clientNum`), the `deviceType` values of APs, gateways and switches,
   and paging with `pageSize=100` and `totalRows`.
9. `PATCH …/aps/{apMac}/wlan-group` through the tunnel on 6.3 (§12):
   - whether an AP-group id is accepted as `wlanGroupId`, and which MAC form it expects (`AA-BB-CC-DD-EE-FF` is sent);
   - how long `ap-groups/aps` takes to show the new group (the session re-reads up to 3 times, 1 s apart);
   - the errorCode for a move into the AP's current group ("cannot be the current wlan group").
10. What a view-only credential answers for each write (AP-group create / rename / delete, the SSID writes and
    bindings, the AP move): its code and message, which the session shows.
11. Whether a bulk move stays under the rate limit: each move is 1 PATCH plus 1–3 paged reads, through the one
    throttle of the credential.
12. Whether the tunnel's `GET …/sites` lists the controller's site ids in the format the IPC site-id guard accepts
    (`[A-Za-z0-9_-]{1,64}`).

## 12. The cloud controller session (phase I-1b1)

`new ControllerSession({kind: 'cloud', omadacId, name, orgVersion, createOpenApiClient, sleep?})`
(`src/main/controller-session.ts`; its data side is `CloudControllerBackend` in `src/main/cloud-controller-session.ts`).
It is Electron-free and unit-tested on fixtures (`tests/unit/cloud-controller-session.test.ts`,
`tests/fixtures/cloud/controller-tunnel.json`). `ConnectionManager` installs it for a cloud target (§13), which
`omada:switch-controller` or the startup target selects.

- **Inputs** (main only):
  - the organization's `omadacId`, name and `orgVersion`, from the organization list, never `/api/info`;
  - a factory of cloud-route `OpenApiClient`s for that organization. Production:
    `new OpenApiClient({route: 'cloud', target, tokenProvider: account, throttle: account.throttle, transport})`.

  A factory rather than one client: the session creates one data client per connect and one management client per
  capability run, and closes them as the local session does. All of them share the account token and the
  credential's throttle. A created client that is not a cloud-route client of this `omadacId` is closed and refused.
- **No internal client.** The session never calls `/api/info`, `/api/v2/…` or the controller's own token endpoint.
- **Version:** `orgVersion` goes through `controller-version.ts`. Without a dotted version or below 6.3, `connect()`
  refuses with `versionUnknown` / `versionTooOld` before any request, and the capability checks answer
  `legacyController` without one.

### The calls

| Need | Call (behind `{serverHost}/v1/cloudaccess/{deviceId}`) | Rule |
|---|---|---|
| Sites (connect) | `GET /openapi/v1/{omadacId}/sites` (paged) | a listing not proven complete → `listIncomplete` (before anything else: no pick from a partial list); then the only site, or the remembered id while it is listed (`pickSite()`, the local rule); otherwise the user picks a listed id; none → `noSites` |
| Access points | `GET …/sites/{siteId}/ap-groups/aps` (paged to `totalRows`) | see below |
| Groups | `GET …/sites/{siteId}/ap-groups` (paged) | see below |
| Capability check | `GET /openapi/v1/{omadacId}/sites` | the token works and the site is still listed |
| AP move | `PATCH …/sites/{siteId}/aps/{apMac}/wlan-group` `{"wlanGroupId": "<AP-group id>"}`, then `GET …/ap-groups/aps` | see below |
| Management | the phase 16–19 calls (§6) | the shared `ControllerSession` code, unchanged |

- **Access points** (`toCloudAccessPoint()`), the renderer's `AccessPoint`:
  - A field not reported sanely is unknown, never a default that looks real. No `statusCategory` → `-1` (shown as
    unknown, not as disconnected); no `clientNum` → absent; no `apGroupId` → no `wlanId`; no `apGroupName` → `''`
    with `wlanGroupUnknown: true` (phase I-1c2a: the renderer shows "Unknown group", never "Unassigned", in the AP row,
    the group filter, the details pane and a move's sources); no name → the MAC (as the internal list does).
  - `wlanId` (new, optional) is the AP's group id.
  - A row whose `deviceType` is `Gateway` or `Switch` is left out. Every other row is an AP, one without the field
    included.
  - A row without a usable MAC refuses the listing (`malformedResponse`); a listing not proven complete is
    `listIncomplete`. Sorted by name.
- **Groups** (`toCloudGroupListing()`, through the management DTO rules of `toManagedApGroup()`):
  - every group, empty ones included;
  - `wlanId` is the Open API id, so a move target id is the Open API id;
  - the SSID names, with `ssidListUnknown: true` and an empty list when they are not reported sanely (never "no
    networks");
  - the default flag, and `remainingBinding` (the per-band remaining capacity; new and optional).

  Sorted by name; an incomplete listing is `listIncomplete`.
- **Capabilities:** checks 1, 3 and the sites read of check 4 run. §2.2 (4)–(5) compare internal with Open API data
  and do not apply: the site came from the Open API list itself, so the sites read only proves that it is still
  listed, and the AP-group comparison never runs. Management is on when the token works and the site is listed. No
  reason code is new. Every refusal's diagnostic carries the controller's code and redacted message (§6), so a
  view-only credential's refusal of a write shows both.
- **AP moves:** the MAC and the group id pass the `omada:set-wlan` guards (`MAC_REGEX`, `WLAN_ID_REGEX` in
  `ipc-guards.ts`) before any request. The MAC is sent as `AA-BB-CC-DD-EE-FF`, the ops doc's form.
  - **The verification rule:** an AP counts as moved only when a re-read of `ap-groups/aps` lists it (by MAC) with
    the destination group's id. There are up to 3 reads (`CLOUD_MOVE_VERIFY_READS`): the first right after the PATCH,
    then 1 s apart (`CLOUD_MOVE_VERIFY_DELAY_MS`, an injected sleep).
  - **Failures** (the last read decides): `moveRequestFailed` (the PATCH failed; codes and the controller's message),
    `moveNotConfirmed` (the AP is in another group, or missing from a complete list), `moveUnverified` (the read
    failed, was incomplete without the AP, or reported no group for it).
  - **The result keeps the shape of `omada:set-wlan`:** `true`, or a rejection whose message starts with the code
    (`moveNotConfirmed (AP listed in another group, 3 reads)`), so the 13b results flow shows it with Retry.
  - The candidate fallback `PATCH ap-groups/{id}` with `{name, addApMacs}` is not implemented (spec).
- **Close and supersede** (the `ManagedController` contract):
  - `close()` drops the management clients and the capabilities with the local session's code; the management
    replies then answer `notConnected` / `superseded` the same way.
  - The data client keeps serving until `logout()` (the release), as the local internal client does. `logout()`
    closes it and sends nothing: there is no server-side session, and the account token belongs to the account
    client.
  - Afterwards every data call is `notConnected`; a call whose client closes while it runs is `superseded`.
- **Errors:** `CloudSessionError` carries a stable code (`CLOUD_SESSION_ERROR_CODES`; each has an es / en text
  `cloudSessionError…` in `src/renderer/i18n-strings.ts`), a sanitized diagnostic and `openApiCode`: the failed call's
  `OpenApiError` code, e.g. `invalidCredentials` or `rateLimited`, for the I-1c messages. Its message is
  `<code> (<diagnostic>)` (`describeCloudSessionError()`: the `openApiCode` is added in front of the diagnostic when
  the diagnostic does not name it already). The connect `detail` and the move rejection carry this text, code first.

## 13. Connection targets (phases I-1b2b1, I-1b2b2)

`ConnectionManager` (`src/main/connection-manager.ts`) connects to a target (`src/main/connection-target.ts`):
`{kind: 'local'}` (the configured controller, reached directly; the default) or `{kind: 'cloud', omadacId}`.
Electron-free, unit-tested in `tests/unit/connection-targets.test.ts`. The renderer's controller switcher (phase
I-1c2b) switches it through `omada:switch-controller`, and the app starts on the stored target (both below).

- **`switchTarget(target)`:** in one synchronous step, before any await, the target changes and the transition of a
  URL change runs (`invalidateControllerState()`): every in-flight connect, the pending site choice and trust
  decision, and the installed session (its Open API clients and tokens, its managed reads and writes) are superseded,
  and their late results are dropped. Then `activeController` is persisted and the new target connects. Switching
  to the current target is a plain reconnect through the same transition. An invalid target (an `omadacId` that
  fails `isOmadacId()`) is refused before any state change.
- **Cloud connect:** `CloudAccessService.findOrganization()` reads a fresh organization list (the account token is
  reused). Each refusal is `connectError` with a code-first `detail`, before any session or cloud-route client
  exists:
  - `notConfigured`: no usable cloud credential;
  - the account's codes (`credentialInvalid (errorCode -52602)`, `rateLimited`, …, as in §9);
  - `listIncomplete (organization list incomplete)`: the list is truncated — refused even when the `omadacId` is on
    a page that was read (fail-closed, like a truncated site list);
  - `unknownController`: the complete list does not hold the `omadacId`;
  - the organization's reason (`cloudControllerReason()`): `notController`, `incompleteEntry`, `unsupportedHost`,
    `versionUnknown`, `versionTooOld`, `offline`.

  Otherwise `createCloudControllerLookup()` (`src/main/cloud-connect.ts`) builds the §12 session, with
  `createOpenApiClient: () => new OpenApiClient({route: 'cloud', target, tokenProvider: account, throttle:
  account.throttle, transport})`, where `target` comes from `cloudControllerTarget()` and `transport` is the
  cloud transport (§8). The session connects with `cloudSites[omadacId]`. A site the user picks is persisted there,
  never in the local `siteId`. A session failure's `detail` is the `CloudSessionError` text (code first,
  `describeCloudSessionError()`), scrubbed again by value of the `deviceId`, the `serverHost` origin and host, and
  the account's live secrets.
- **Local connect:** unchanged. A successful one (installed, or completed by a site choice) persists the
  `/api/info` `omadacId` as `localOmadacId`, only when it is usable and differs from the stored one, and only for
  the URL that connect used. A failed one whose controller never answered at all carries `unreachable: true` beside
  `connectError` (phase I-1c2a): its first request, `/api/info`, got no response — the request timeout or an Electron
  net error such as `ERR_CONNECTION_REFUSED` or `ERR_NAME_NOT_RESOLVED` (the transport's typed `TransportError`,
  `isUnreachableTransportError()`, recorded as `OmadaController.connectUnreachable`). A failure after any response (a
  timeout or reset during the login or the site list), an HTTP error and a certificate error never count. The renderer
  may then offer "Connect through TP-Link cloud" for the local controller's cloud duplicate.
- **Cloud credential change:** a save that changes the cloud credential while the target is a cloud controller runs
  the same transition (`applyConfigSave()`, `cloudCredentialsChanged`), and the `config:save` reply then carries
  `connectionReset: true`, as for a URL change (`finishConfigSave()`), so the renderer drops its connected UI. On
  the local target such a save changes nothing and reports no reset.
- **Local management save:** `applyManagementAccessChange()` skips an installed cloud session, whose access is the
  account's cloud route, not the local Open API credentials.
- **Startup:** once the app is ready, before the window exists, `index.ts` calls
  `connectionManager.startOn(getStartupTarget())` (`config.ts`): `resolveStartupTarget(config,
  getCloudCredentials() !== null)` through `startupTargetOf()`, which reads the credential only when
  `activeController` names a cloud controller. It returns the stored cloud `omadacId` only while the cloud
  credential is usable (a Client ID with a secret, the session-only fallback included). Otherwise it returns local:
  `activeController` survives a dropped credential and is not rewritten. `startOn()` sets the target without a
  transition, a write or a connect, and only while nothing has run yet; the renderer's first `omada:connect` then
  connects that target. With the local controller active the start is unchanged. A cloud-only configuration (phase
  I-1c2a) starts on its stored cloud controller while the credential is usable; otherwise on local, whose connect
  answers `configIncomplete`. `config:load` reports main's current target as `connectionTarget` (`'local'` or the
  omadacId), so the renderer knows what its first `omada:connect` reaches.
- **Switch IPC** (`omada:switch-controller`, preload `switchController(target)`, reply: the new target's
  `ConnectionResult`): the trusted sender, then `parseControllerTargetRequest()` (`ipc-guards.ts`), which accepts
  exactly `{kind: 'local'}` or `{kind: 'cloud', omadacId}` (a plain object, no other key, `isOmadacId()`) and
  rejects anything else before any state changes; then `switchTarget()` as above. The renderer drops its
  session (generation and nonce) before calling it (the switcher, phase I-1c2b).
- **Session nonces on the data channels:** `omada:get-aps`, `omada:get-wlans` and `omada:set-wlan` carry the
  session nonce of the connect result first, for local and cloud sessions alike. A missing or malformed nonce is
  rejected by the guard. Then `sessionDataReply()` (`controller-session.ts`) refuses, before any controller call, a
  call with no installed open session (`notConnected (…)`; also while a newer connect is in flight) or another
  session's nonce (`superseded (…)`). A result or failure that settles after a switch, a reconnect or a transition
  is refused as `superseded`. The replies keep their shapes, so a refusal is a rejection whose message starts with
  the code. The renderer's load, refresh and move flows capture the nonce and generation at their start
  (`src/renderer/session-ticket.ts`) and discard a reply that arrives for a replaced session.
- **A cloud session in the renderer:** a cloud session's `url` is `''`, so its connect result carries
  `controllerName` (the organization name; absent for a local session), and the header shows that name in place of
  a host (`controllerHostLabel()`, `src/renderer/validation.ts`). The configured local URL never labels a cloud
  session, and an empty URL labels nothing.
