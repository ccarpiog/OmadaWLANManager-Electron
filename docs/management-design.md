# AP Groups & Wi-Fi Network Management — Design Spec

Status: **approved plan, not yet implemented** (2026-10-06). Executed by autoclaude phases 8–20
(see `PROGRESS.md` and `todo.md` section 4). Sources: live findings in
`docs/omada-6.3-api-findings.md`, the Open API extract in `docs/omada-openapi-ops.md`, and two Codex
reviews (architecture/security and UI/information architecture) reconciled with the user's decisions.

## 1. User decisions (2026-10-06)

| # | Decision |
|---|---|
| D1 | **Hybrid architecture.** Keep the internal username/password API for viewing and moving APs. Add an optional **Open API Client ID/Secret** that unlocks AP-group and Wi-Fi network management. |
| D2 | **Groundwork first:** renderer modularization (esbuild), a test harness, the Electron upgrade, and URL-scoped credentials + certificate TOFU pinning all land before any management feature. |
| D3 | **Wi-Fi network editing scope:** full create/edit for **Open** and **WPA-Personal** networks. WPA-Enterprise and PPSK networks: view, enable/disable, link to AP groups and delete only. |
| D4 | **No live-controller tests during autoclaude runs.** Everything is verified with `npm run build`, unit tests with fixtures and GUI smoke tests against a stubbed main process. The user tests against the real controller afterwards using `docs/live-test-checklist.md` (written in phase 20). |
| Defaults adopted | Controllers < 6.3: AP assignment only (no legacy CRUD). "All devices" SSIDs: binding read-only. App-policy block on deleting the default group, non-empty groups, and groups that still have SSID bindings. Client Secret is never stored in plaintext. Test AP for the later manual checks: "EAP Carpio". |

**Hard rule for every phase:** never contact the real controller (`192.168.1.130`) and never read
or write the user's real config (`~/.omada-wlan-manager/`). GUI smoke tests launch Electron with
`HOME` pointed at a throwaway directory and a stubbed main process (see PROGRESS.md, item 1.10 notes).

## 2. Architecture

### 2.1 Modules (main process)

- **`InternalOmadaClient`** (today's `OmadaController`, renamed/split): `/api/info`, username/password
  session + CSRF, sites, devices, the group list, and **all AP moves** (`PATCH sites/{site}/eaps/{mac}
  {wlanId}` — live-verified on 6.3.0.45 and the only move path used, so moving APs never needs Open API
  credentials).
- **`OpenApiClient`** (new): Client ID/Secret token lifecycle and the documented `/openapi/v1|v2/…`
  management endpoints. Its own transport (supports `GET/POST/PATCH/PUT/DELETE`, the
  `Authorization: AccessToken=<token>` header, pagination). Keep the per-endpoint API version explicit
  (SSID list/create are **v2**; SSID detail/update/delete/binding and all AP-group calls are **v1**).
- **`ControllerSession`** facade: normalized URL, `omadacId`, selected site, `controllerVersion`,
  `groupModel` (`'apGroup' | 'wlanGroup'`), `capabilities`, and both clients. IPC handlers talk only to
  the facade.
- The renderer receives **domain DTOs and capability flags only** — never raw controller responses.

### 2.2 Compatibility and capability policy

- Parse `controllerVer` from `/api/info` (kept since phase 12: `src/main/controller-version.ts`).
- `controllerVer >= 6.3` → `groupModel = 'apGroup'` ("AP groups" vocabulary).
- Older or unparseable version → `groupModel = 'wlanGroup'`, vocabulary "WLAN groups (legacy)",
  assignment only, management views read-only with an explanatory banner.
- **Management is enabled only when all of these pass** (the version alone never grants it):
  1. `groupModel === 'apGroup'`;
  2. a Client ID and Client Secret are configured;
  3. token acquisition succeeds;
  4. read probe: `GET /openapi/v1/{omadacId}/sites` contains the selected internal site id;
  5. read probe: `GET …/sites/{siteId}/ap-groups` succeeds and its id set **equals** the id set from
     the internal `setting/wlans` (otherwise disable management and show a diagnostic — never match
     groups by name).
- Capabilities are computed in main, sent to the renderer as flags plus a **reason code** for
  each disabled capability (shown in the read-only banner).

### 2.3 Data sources

| Data | Source |
|---|---|
| Group list (incl. **empty** groups), default flag, per-band capacity | internal `GET setting/wlans` (authoritative list) |
| SSID names per group (overview) | internal `GET setting/ssids`, outer-joined onto the list above |
| APs, status, current group | internal `GET devices` (+ `eaps/{mac}` for single-AP detail and overrides) |
| AP-group detail, `apNum`, `ssidNameList`, `remainingBinding` (management) | Open API `GET …/ap-groups` |
| Wi-Fi network catalog / detail / bindings (management) | Open API v2 `GET …/wireless-network/ssids`, v1 `GET …/ssids/{id}`, v1 `GET …/ssids/{id}/ap-groups` |

Without Open API credentials, the AP groups and Wi-Fi networks views still work **read-only** from
the internal data (group ↔ SSID-name mapping).

## 3. Security requirements

- **Client Secret:** stored only as a `safeStorage` blob (`encryptedClientSecret`) through the same
  code path as the password. If `safeStorage` is unavailable, **refuse to persist it** and allow
  session-only use (unlike the password's legacy plaintext fallback). Renderer gets `hasClientSecret` only.
- **Access tokens:** memory only; on expiry re-acquire **once** per request (shared in-flight
  promise, like `sharedRelogin()`); never persisted.
- **URL-scoped credentials (phase 11):** changing the controller URL clears the stored password,
  Client Secret, site id and certificate pin, and requires fresh credentials (fixes today's bug where a
  blank password field reuses controller A's password for controller B, `src/main/config.ts`).
- **Certificate TOFU pinning (phase 11, todo 2.3b):** on first connection to a host, show the
  certificate's SHA-256 fingerprint in a first-use confirmation dialog; store the pin per normalized
  origin; reject any later mismatch with a clear "certificate changed" dialog offering an explicit
  reset (re-trust) in Settings. Never send the password or Client Secret before the pin check passes.
- **SSID passphrases:** an existing `securityKey` **never** crosses to the renderer; DTOs expose
  `hasPassphrase`. A newly typed passphrase crosses renderer → main once.
- **Read-merge-write:** `basic-config` PATCH is a full body. Main fetches fresh detail, validates it,
  merges only allowlisted edited fields, and submits. Because passphrase-unchanged semantics are
  **unverified** (D4), saving `basic-config` for a WPA-Personal network **requires the user to re-type
  the passphrase** (the UI explains why). `enable` and `ap-groups` changes use their dedicated
  endpoints and never need the passphrase.
- **Redaction:** one central redactor for `password`, `client_secret`, `securityKey`, `psk`,
  `Authorization`, cookies, CSRF, access/refresh tokens. No raw request/response bodies in logs or in
  error `detail` sent to the renderer; management errors use stable, localized error codes plus
  sanitized diagnostics.
- **New IPC channels:** sender assertion (`assertTrustedIpcSender()`), strict runtime shape checks,
  id (24-hex) and MAC format checks, enum checks, UTF-8 byte-length limits (SSID name 1–32 bytes, group
  name 1–128 chars), array caps + dedupe, session-ownership check (generation/nonce, as in phase 7), and
  validated response DTOs.
- **Destructive or broad actions** (AP moves, delete, disable, binding replacement,
  security/passphrase change) always go through a confirmation that names the objects and the effect.
- **App-policy deletion rules:** the default group cannot be deleted; a group can be deleted only when
  it has 0 APs **and** no SSID bindings.

## 4. UI and information architecture

### 4.1 Vocabulary (es/en parity mandatory)

| Concept | English | Spanish |
|---|---|---|
| View 1 | Access points | Puntos de acceso |
| View 2 (6.3+) | AP groups | Grupos de AP |
| View 2 (legacy) | WLAN groups (legacy) | Grupos WLAN (heredado) |
| View 3 | Wi-Fi networks | Redes Wi-Fi |
| Technical term, shown in forms only | Network name (SSID) | Nombre de red (SSID) |
| Empty group label | No Wi-Fi networks — silences these APs | Sin redes Wi-Fi — silencia estos AP |
| Move action | Move AP / Move 4 APs | Mover AP / Mover 4 AP |
| Group membership action | Move access points here | Mover puntos de acceso aquí |

Never offer "remove AP from group": an AP is always in exactly one group, so leaving a group always
means moving to a destination.

### 4.2 Global shell

```text
┌ Site: Colegio Hispano Inglés ▾      ● Connected · Updated 10:42      ⟳ Refresh ┐
├──────────────────┬──────────────────────────────┬──────────────────────────────┤
│ Access points  16│  (view content: list)        │  (view content: detail /     │
│ AP groups      36│                              │   action pane)               │
│ Wi-Fi networks 30│                              │                              │
│                  │                              │                              │
│ ⓘ Read-only: … │                              │                              │
│ ⚙ Settings      │                              │                              │
└──────────────────┴──────────────────────────────┴──────────────────────────────┘
```

- Left sidebar: the three views with **total** counts (not filtered); site switcher and connection
  state stay visible; capability/read-only indicator, language and Settings at the bottom.
- **Landing view: Access points** (the most frequent job stays first).
- Refresh keeps current data on screen and shows a lightweight "refreshing" state plus "Updated hh:mm".
- **Cross-navigation:** clicking a group or network name anywhere switches view, selects it, and offers
  "← Back to <previous item>".

### 4.3 Access points view (core job — must stay as fast as today)

```text
│ Search APs…   Status ▾  Group ▾     │ Move selected APs               │
│ ☐ ● Aula 1        Grupo A   8 nets  │ Search groups or networks…      │
│ ☑ ● Aula 2        Grupo A   8 nets  │ ○ Grupo A · 8 networks          │
│ ☑ ● Biblioteca    zNinguna  —       │ ○ Grupo B · 6 networks          │
│                                     │ ── Silence ──                   │
│ 2 selected (1 hidden by filters)    │ ○ zNinguna · No Wi-Fi networks  │
│                                     │   — silences these APs          │
│                                     │ Gains: +2   Loses: −1           │
│                                     │ [ Review and move 2 APs ]       │
```

- Rows: status as **text + color**, AP name, current group, network count (not a chip per SSID),
  client count. Native checkboxes for multi-select; clicking a row (not its checkbox) opens AP details
  (effective networks with override badges, link to its group).
- Shift-click / Shift+Arrow range selection; explicit "Select all N filtered APs"; selection survives
  filtering ("3 selected, 1 hidden by filters").
- The destination pane is **always visible** (no extra navigation step). Destination search matches
  group names **and** SSID names. Empty groups appear in a pinned "Silence" section with the strong label.
- Mixed selections: "12 already in this group; 4 will move"; no-op moves disabled.
- Review/confirm summarizes source group(s) → destination, networks gained/lost/unchanged, APs with
  per-AP overrides, and clients currently connected **to the moving APs** (never claim per-SSID clients).
- Bulk moves are sequential PATCHes, **not atomic**: show a per-AP result list with "Retry failed".
- Specific button labels ("Move AP", "Move 4 APs") instead of "Apply change".

### 4.4 AP groups view

- Master list: name, AP count, network count, badges **Default**, **Empty**, **Capacity warning**.
- Detail sections: Overview (rename) · Access points (list + **Move access points here**, which opens an
  AP picker and uses the same review/confirm flow as 4.3) · Wi-Fi networks bound to this group as
  **read-only linked rows** · Per-band remaining capacity (2.4 / 5 / 6 GHz, MLO).
- **New group** creates an empty group (name only); APs are then moved in with the flow above.
- Delete: hidden for the default group; for other groups shown with an explanation and only enabled
  when the group has 0 APs and no bindings ("Move its access points and unlink its networks first").
- Binding edits are **not** made here (single canonical editor lives in 4.5).

### 4.5 Wi-Fi networks view

- Master list: name, enabled state, security, bands, scope ("All access points" or "N groups · M APs").
- Detail opens **read-only**; **Edit** enters a staged form with Save / Cancel (no auto-save, no
  immediate toggles mixed with staged edits).
- Common fields visible (name, enabled, security, bands, hidden/broadcast, guest, VLAN); advanced
  fields collapsed (PMF, 802.11r, MLO). Password via a separate **Change password** action, never
  prefilled; WPA-Personal saves of basic settings require re-typing the passphrase (see §3).
- **Broadcast on** (the single canonical binding editor): "All access points, including future ones"
  vs "Selected AP groups" (searchable checkboxes). Show before/after reach (groups, APs) and APs with
  overrides. Validate per-band capacity before Save and name the exact groups/bands lacking capacity.
  Existing "All access points" networks: this control is **read-only** until the live checklist
  confirms the semantics — never silently convert to an explicit list.
- **New network** (Open / WPA-Personal): created **disabled** by default with an "Enable after
  creating" checkbox off; bound to the selected groups at creation (`apGroupIds`, `chooseDevices = 1`).
- Enterprise / PPSK networks: view, enable/disable, Broadcast on, delete; edit/creation hidden with an
  explanation.
- Delete: confirmation lists the bound groups and AP count that will stop broadcasting it.

### 4.6 States

- First run: one clear **Configure connection** action.
- Disconnected: navigation stays; content shows **Connect to controller**.
- Initial loading: progress/skeletons inside the layout. Refreshing: keep data, mark as refreshing.
- "No data" and "no search results" are distinct; the latter offers **Clear filters**.
- Initial-load error: persistent inline error with Retry and Settings. Refresh error: keep stale data,
  show the last-updated time.
- Read-only banner always states the precise reason and the fix, e.g. "Open API credentials are not
  configured — viewing is available. Add them in Settings → Management access." / "Legacy controller —
  moving APs is available; editing groups and networks requires Omada Controller 6.3 or later." No
  unexplained disabled controls.
- Settings gains a **Management access (optional)** section: Client ID, Client Secret (never shown back;
  "stored" indicator), help text on creating the app under *Global View → Settings → Platform Integration
  → Open API*, and a **Test management access** button reporting each capability check from §2.2.

### 4.7 Accessibility, keyboard, window sizes

- Native checkboxes/radios/buttons/links instead of `div` listbox simulations; visible focus; textual
  states; `aria-live` announcements for selection counts and operation results; dialogs with
  descriptions; focus trapped in modals and restored to the opener; destructive confirmations focus
  Cancel (or the heading), never the destructive button.
- Keys: arrows navigate lists; Space toggles a checkbox; Shift+click / Shift+Arrow extends selection;
  Escape clears search → exits edit mode → closes the top dialog; Cmd/Ctrl+F focuses the current view's
  search.
- 40–44 px targets, contrast, `prefers-reduced-motion`, usable at 200% zoom.
- Minimum window stays **700×500**, responsive: ≥1000 px full sidebar + list/detail split;
  800–999 px compact (icon) sidebar + split; 700–799 px top view switcher + single-pane drill-in (the
  destination picker opens as a full pane with Back). Content panes scroll independently; action bars
  and modal buttons stay visible at short heights.

## 5. Unverified API behaviors and the defensive defaults

| Unknown (no live tests, D4) | Default implemented |
|---|---|
| Open API token endpoint/body/header details (not in the self-hosted spec) | Implement TP-Link's documented client-credentials flow; surface precise error codes; "Test management access" reports it. |
| Internal site id == Open API `siteId` | Capability check §2.2 (4); mismatch → management disabled with diagnostic. |
| Internal group id == Open API `apGroupId` | Capability check §2.2 (5); mismatch → management disabled with diagnostic. |
| SSID list enable field (`ssidEnable` vs a boolean named `description`) | Accept `ssidEnable` if boolean, else `description` if boolean, else "unknown" and the toggle is hidden. |
| Whether SSID detail returns the passphrase in clear | Never forward it; require re-typing it for WPA-Personal `basic-config` saves. |
| How the binding PATCH enters/leaves "All devices" | "All access points" networks: binding read-only; never send a binding PATCH for them. |
| What the controller does with APs of a deleted group | App policy: only empty, unbound, non-default groups can be deleted. |

## 6. Live-test checklist (to be written as `docs/live-test-checklist.md` in phase 20)

For the user, run interactively after implementation, on "EAP Carpio" plus disposable resources only:
snapshot EAP Carpio's group id → create empty group `__OWM_TEST_<timestamp>` → create a **disabled**
WPA-Personal network with a throwaway passphrase bound only to that group → edit it, change its
passphrase, toggle enable while the group is empty → verify each §5 unknown → move EAP Carpio into the
test group and back (restore in all cases) → unbind and delete the network → delete the group →
confirm no `__OWM_TEST_` resources remain. Delete only by captured ids, never by name. Never use
production groups (e.g. `zNinguna`) as test objects.

## 7. Considered and dropped: several controllers and TP-Link cloud access (2026-10-06)

The user's TP-Link Cloud Access portal lists three controllers, all on 6.3.0.45: "OC200 Planta 3",
"OC200 Planta 4" (OC200 hardware) and "Omada red antigua (Proxmox)" (the software controller this app
uses). The two OC200s are **not on the user's local network**.

- TP-Link's documented Open API cloud domain (`https://euw1-omada-northbound.tplinkcloud.com`, token
  path `/openapi/authorize/token`) does **not** know local controllers. A token request with the
  software controller's `omadacId` (Cloud Access enabled) and fake client credentials returned
  `{"errorCode":-7131,"msg":"Controller ID not exist."}`. That API serves TP-Link's cloud-hosted
  Omada Central only, which matches the Home Assistant Open API integration README. The domain
  `euw1-northbound-omada-controller.tplinkcloud.com` does not resolve.
- The Cloud Access portal itself logs in with a TP-Link ID and proxies the web UI through undocumented
  endpoints, which is too fragile to build on.
- **User decision:** drop multi-controller support. The app stays **single-controller**, reached
  directly (LAN or VPN). If this is revisited, the design was: saved controller profiles (config schema
  v2 with migration), all secrets, site, pin and capabilities per profile, a controller switcher above
  the site switcher, and one active connection at a time. It would fit as a new phase between the
  Electron upgrade and TOFU pinning.
