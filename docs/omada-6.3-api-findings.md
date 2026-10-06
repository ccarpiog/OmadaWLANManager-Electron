# Omada Controller 6.3 — API findings (AP Groups & SSIDs)

Live-tested on 2026-10-06 against the school controller (`https://192.168.1.130:8043`,
**Omada Controller 6.3.0.45**, one site "Colegio Hispano Ingles"). Write tests were limited to the
AP "EAP Carpio" (MAC `10-27-F5-37-3C-3A`, normally in AP Group `A_VIRUS`), with the user's permission,
and the AP was restored afterwards.

## What changed in 6.3 (product level)

- WLAN Groups no longer exist. On upgrade they were converted into **AP Groups** with the same names.
- SSIDs are defined per site and bound to **one or more AP Groups** (many-to-many), or to "All devices".
- Each AP belongs to **exactly one** AP Group (the "Default AP Group" after adoption).
- SSIDs still **cannot** be assigned directly to an individual AP. Per-AP SSID overrides still exist.
- Sources: TP-Link doc 127532 "How to Configure WLAN Using AP Groups in Omada Controller v6.3";
  Omada Software Controller v6.3.0 release notes (Enhancement 1).

## Internal web API (what the app uses today)

Base: `/{omadacId}/api/v2/…`, session cookie `TPOMADA_SESSIONID` + `Csrf-Token` header, login with
username/password (`POST /{omadacId}/api/v2/login`). Undocumented; mirrors what the web UI calls.

| Call | Status on 6.3.0.45 | Notes |
|---|---|---|
| `GET sites/{site}/setting/ssids` | ✅ works, same shape | `{ssids:[{wlanId, wlanName, ssidList:[{ssidName,…}], deviceType:"ap"}]}`. `wlanId` is now the **AP Group id**. **Omits AP Groups that have no SSIDs** (36 groups exist, 34 returned; missing: `CHICarpio`, `zNinguna`). |
| `GET sites/{site}/setting/wlans` | ✅ works | Full AP Group list incl. empty groups: `result.data[]` = `{id, name, primary, site, clone, resource, remainingBinding:{"2.4GHz","5GHz","6GHz","mlo"}}` + `maxSsids2G/5G/6G/Mlo`. `primary:true` = default AP Group. |
| `GET sites/{site}/setting/wlans/{wlanId}/ssids` | ✅ works | Paged SSID list of one group: `{id, name, band, security, broadcast, ssidEnable, vlanEnable, deviceType, chooseDevices, apGroupNum, apNum, pskSetting, …}` (legacy per-group view). |
| `GET sites/{site}/devices` | ✅ works | AP entries keep `wlanGroup` (now = AP Group **name**). |
| `GET sites/{site}/eaps/{mac}` | ✅ works | `wlanId` = AP Group id; new `apGroupName`; `ssidOverrides[]`. |
| `PATCH sites/{site}/eaps/{mac}` `{wlanId}` | ✅ works (verified live) | Moves the AP into that AP Group; the AP then broadcasts that group's SSIDs. |

Probed and **not available** (errorCode `-1600 Unsupported request path`): `setting/ap-groups`,
`setting/apGroups`, `ap-groups`, `apGroups`, `ap-groups/aps`, `setting/ap-groups/aps`,
`count-ap-groups`, `setting/wireless-network/ssids`, `wireless-network/ssids`, `setting/wlans/{id}`,
`setting/ssids/{ssidId}`, `setting/ssids/{ssidId}/ap-groups`, `setting/wlans/{id}/ssids/{ssidId}`,
`setting/wlans/{id}/ssids/{ssidId}/ap-groups`.

**Unknown on the internal API:** the write calls for creating/renaming/deleting AP Groups, creating/editing
SSIDs and changing SSID↔AP-Group bindings. They could only be found by capturing the web UI's network
traffic (browser dev tools) while doing those actions — not done, and fragile across upgrades.

## Official Open API (documented)

The controller hosts its own spec: Swagger UI at `/swagger-ui/index.html`, knife4j at `/doc.html`,
spec groups listed at `/v3/api-docs/swagger-config` (e.g. `/v3/api-docs/00 All`, title "Omada Open API",
version "v0.1"). Paths: `/openapi/v1|v2/{omadacId}/…`.

**Authentication (NOT in the self-hosted spec — verify before relying on it):**
- An admin must create an application under *Global View → Settings → Platform Integration → Open API*
  and note its **Client ID** and **Client Secret** (the app's role/site scope is chosen there).
- Client-credentials mode: `POST /openapi/authorize/token?grant_type=client_credentials` with JSON body
  `{ "omadacId", "client_id", "client_secret" }` → `result.accessToken` (+ `expiresIn`, `refreshToken`).
- Every call then sends `Authorization: AccessToken=<token>` (the `AccessToken=` prefix is required —
  TP-Link doc 109315).
- An authorization-code mode also exists (user logs in with username/password via `/openapi/authorize/login`
  and `/openapi/authorize/code`, still needs Client ID/Secret).

**Operations relevant to this app** (full parameters/bodies/responses in `docs/omada-openapi-ops.md`):

| Purpose | Call |
|---|---|
| List AP Groups (+ `apNum`, `ssidNameList`, `remainingBinding`) | `GET /openapi/v1/{omadacId}/sites/{siteId}/ap-groups?page&pageSize` |
| Create AP Group `{name*, apMacs[]}` | `POST /openapi/v1/{omadacId}/sites/{siteId}/ap-groups` |
| AP Group detail | `GET …/ap-groups/{apGroupId}/info` |
| Rename / add / remove APs `{name*, addApMacs[], removeApMacs[]}` | `PATCH …/ap-groups/{apGroupId}` |
| Delete AP Group (default group cannot be deleted, `-33203`) | `DELETE …/ap-groups/{apGroupId}` |
| All APs with their `apGroupId`/`apGroupName` | `GET …/ap-groups/aps?page&pageSize` |
| AP Group limit check | `GET …/count-ap-groups` |
| Move an AP to a group `{wlanGroupId*}` | `PATCH …/aps/{apMac}/wlan-group` |
| List site SSIDs | `GET /openapi/v2/{omadacId}/sites/{siteId}/wireless-network/ssids?page&pageSize` |
| Create SSID (incl. `apGroupIds[]`, `chooseDevices`) | `POST /openapi/v2/{omadacId}/sites/{siteId}/wireless-network/ssids` |
| SSID detail / delete | `GET` / `DELETE /openapi/v1/…/wireless-network/ssids/{ssidId}` |
| Edit SSID basics (name, band, security, PSK, VLAN…) | `PATCH …/wireless-network/ssids/{ssidId}/basic-config` |
| Enable/disable SSID `{ssidEnable*}` | `PATCH …/wireless-network/ssids/{ssidId}/enable` |
| AP Groups bound to an SSID | `GET …/wireless-network/ssids/{ssidId}/ap-groups` |
| Replace an SSID's AP Group bindings `{apGroupIds*[]}` | `PATCH …/wireless-network/ssids/{ssidId}/ap-groups` |
| Duplicate-name check | `GET …/wireless-network/ssids/duplicate-name` |
| Sites / devices | `GET /openapi/v1/{omadacId}/sites`, `GET …/sites/{siteId}/devices` |
