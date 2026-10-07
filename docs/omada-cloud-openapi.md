# TP-Link cloud controllers — the Account Level Open API contract the app follows

Inbox item I-1 (spec: `autoclaude/processed/10-tplink-cloud-controllers.md`, user decisions D5–D7). This file is the
contract the main-process code of phase I-1a follows (`src/main/cloud-*.ts`, the `OpenApiClient` cloud route). Every
detail marked **UNVERIFIED** is taken from the documentation only and is a live-test item (I-1c adds them to
`docs/live-test-checklist.md`).

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

Hiding a cloud entry whose `omadacId` equals the local controller's (`localOmadacId`) is phase I-1c's job.

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
- `ControllerSession` and `ConnectionManager` do not use the cloud route yet (phase I-1b).
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
  - `localOmadacId` is dropped when the controller URL changes. Learning it on a local connect is phase I-1b.
  - `activeController` is `'local'` (also when absent) or an `omadacId`.
  - `cloudSites` maps `omadacId` to a site id; malformed entries are dropped, at most 64 are kept.
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
  - Replies are the DTOs above or a stable code with a codes-only diagnostic.
- **Redaction:** `src/main/redact.ts` covers:
  - `client_secret` / `clientSecret` in any casing and separator;
  - `AccessToken=…`, `Bearer AK-…`;
  - the `accessToken`, `refreshToken` and `refresh_token` keys and query parameters;
  - bare TP-Link token shapes (`AT-…`, `a1-AT-…`, `RT-…`, `AK-…` with 16+ alphanumerics after the prefix).

  The saved cloud secret and the live account tokens are added to the IPC registrar's stored secrets
  (`storedSecrets()` in `index.ts`), so free text is scrubbed of them by value too.

## 11. Unverified behaviors (live-test checklist items)

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
