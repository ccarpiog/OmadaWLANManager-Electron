# Live-test checklist — AP groups & Wi-Fi network management (Omada 6.3)

The app's management features (phases 15–20) were built and tested against fixtures and a stubbed
main process only (decision D4 in `docs/management-design.md`); none of them has been checked on a
live controller yet. This checklist is the manual run against the real controller (Omada Controller
6.3, test AP **EAP Carpio**) that checks the behaviors still marked "unverified live" (the unknowns
of spec §5 and those recorded in phases 12–20a) as far as they can be observed safely on a
production controller. It follows the order of spec §6. The [cross-reference table](#cross-reference)
at the end maps every item to the steps that observe it, says whether a run covers it fully, partly
or not at all (and why), and has a column for your result.

[Part C](#part-c--tp-link-cloud-controllers) is a separate run for the optional TP-Link cloud access
(inbox item I-1): the remote controllers reached through TP-Link's Account Level Open API (beta), the
controller switcher and "Connect through TP-Link cloud". It needs a credential from TP-Link's Omada
cloud portal, whose Open API page TP-Link had not enabled for the account as of 2026-10-07.

UI terms are given as bold English / Spanish pairs, such as **Settings** / **Ajustes**: run the app
in either language. A quoted message with "…" stands for the name the app inserts there.

## Safety rules

1. **Disposable resources only.** Every group and network this run creates is named
   `__OWM_TEST_<TS>` (plus a short suffix), where `<TS>` is the run's timestamp.
2. **Delete by captured id only.** Each test resource's id is captured right after it is created;
   before deleting in the app, check that the name you select maps to that id. The probe kit's
   `gdelete` (and `ndisable`) refuse unless both baselines are complete, the id was captured in this
   run with its kind (group or network), it is not in the baseline, and a fresh read names it like
   this run's test resources; a failed read or `jq` error counts as a refusal.
3. **Never touch production groups or networks** (e.g. `zNinguna`, or EAP Carpio's own group):
   they are only read. EAP Carpio is the only access point that moves, and only between its own
   group and the test group (spec §6): that move and its restore are the only changes this run
   makes outside `__OWM_TEST_` resources (Part C adds its own rules for the cloud controllers,
   C.0). A test network is never put on "All access points" and
   never sent an empty AP-group list, since either could bind it to every production group.
4. **Restore in all cases.** If anything goes wrong after EAP Carpio has moved, run
   [Emergency restore](#r-emergency-restore-and-clean-up) at once.
5. **Keep test networks disabled** except where a step says to enable one, and only while it is
   bound to an empty test group or to the test group holding EAP Carpio alone.
6. **Stop rule.** If a step does something the checklist does not expect to a production resource,
   stop and go to [Emergency restore](#r-emergency-restore-and-clean-up).

Each step lists what to **Do** (in the app, unless marked *probe* or *web UI*), what to **Observe**,
what to **Record**, and a result line `☐ pass ☐ fail` for you to tick, with room for notes.

## Record sheet

| Item | Value |
|---|---|
| Date, app commit (`git rev-parse --short HEAD`) | |
| Controller version (header, "Omada …") | |
| `TS` / `T` (test name) | |
| Controller certificate SHA-256 (`FP`) and public-key pin (`PIN`) | |
| `SITE` (Open API) / `ISITE` (internal) | |
| EAP Carpio's group: `ORIG_GROUP_NAME` / `ORIG_GROUP_ID` | |
| `GROUP_A_ID` (group `$T`) | |
| `GROUP_B_ID` (group `${T}_B`) | |
| `NET_ID` (network `$T`, renamed `${T}_E` in 4.1) | |
| `NET2_ID` (network `${T}_2`) | |
| Other captured ids (duplicates, `${T}_P`) | |

## Part 0 — Preparation (nothing is changed)

### 0.1 Build and launch

- **Do:** from the repository, `npm run build`, then `npm start` (or a package built from the same
  commit). Open the Omada web interface in a browser as well.
- **Record:** the commit, and the controller version from the header.

### 0.2 Probe kit (terminal)

The probe kit is a set of shell functions (zsh, the macOS default, or bash; with `curl`, `openssl`
and `jq`: macOS 15 ships `/usr/bin/jq`, otherwise `brew install jq`) that reads the raw Open API
and internal API answers the app never shows. `oget`, `iget` and the functions built on them only
read. Only four functions write, each only where a step says **write probe** or in the
[emergency restore](#r-emergency-restore-and-clean-up), and each refuses any target that is not
one of this run's test resources:

- `gcreate <name>` creates an AP group, only with a name that starts with `$T`, and captures its id.
- `ndisable <id>` disables a Wi-Fi network; `gdelete group <id>` and `gdelete network <id>` delete
  one. Both run only when every check passes, and a failed `curl` or `jq` call counts as a failed
  check: (a) both baselines of 1.2 exist, parse, carry `errorCode` 0 and are complete (as many rows
  as `totalRows`); (b) the id is in this run's `captured-ids.jsonl` with the same kind; (c) the id
  is in neither baseline; (d) a fresh read right before the call lists the id exactly once, with a
  name that starts with `$T` (ignoring case, for the lower-case duplicates of 2.5 and 3.4).
  `capture group <id>` / `capture network <id>` applies (a), (c) and (d) before it records an id.
- `eaprestore` moves EAP Carpio back to `ORIG_GROUP_ID` (1.1), and only if that group is in the
  baseline.

How the kit protects the controller and its credentials:

- **TLS.** Every request goes through `ocurl`, which pins the controller's public key with
  `--pinnedpubkey "$PIN"` and refuses to run while `PIN` is empty (step 2). The controller's
  certificate is self-signed (and usually issued for an IP address), so curl's CA-chain and
  host-name checks would fail: `ocurl` turns those off with `-k`, and the pin, not the CA chain, is
  what authenticates the controller. curl enforces `--pinnedpubkey` even with `-k`: when the
  presented public key differs, it stops with `curl: (90) SSL: public key does not match pinned
  public key` before it sends the request. `--proto '=https'` refuses a plain `http://` URL, where
  no pin would apply.
- **Secrets.** The Client Secret, the controller password, the access token, the CSRF token and
  the session cookie are never exported, never on a command line (where `ps` or the shell history
  would show them) and never in a file of the working directory. They are typed at a hidden prompt
  into plain shell variables; a request body that needs one is built by a single `jq` that gets it
  as a one-command prefix assignment (`CSECRET="$CSECRET" jq …`) and reaches curl on standard input
  (`--data-binary @-`); the token and the CSRF token reach curl as headers through
  `-H @<(printf …)`; the session cookie lives in a private directory (`umask 077`, `mktemp -d`) that
  `kitclose` deletes (Step 9, or the emergency restore). Do not turn on `set -x` while the kit is
  loaded.

The files the kit writes in the working directory hold no secret: the baselines and
`captured-ids.jsonl` (ids and names), `controller.pem` (the controller's public certificate),
`detail-*.json` (the test network's detail with its key hidden) and `survey.jsonl` (only whether a
password is present). The scratch answers of 5.1 and 5.9 go to the private directory.

1. Open a new terminal window, so that nothing from an earlier session is already exported. In zsh,
   run `setopt interactivecomments` first (the snippets below carry `#` comments). Then the
   settings (edit `OC` if your Controller URL differs):

   ```sh
   umask 077
   case "$-" in *a*) printf 'STOP: allexport is on; run  set +a  first\n';; esac
   OC='https://192.168.1.130:8043'         # the Controller URL from Settings
   AP_MAC='10-27-F5-37-3C-3A'              # EAP Carpio
   TS="$(date +%Y%m%d%H%M)"                # run timestamp, e.g. 202610081030
   T="__OWM_TEST_$TS"                      # name of every test resource
   mkdir -p "$HOME/owm-live-$TS" && cd "$HOME/owm-live-$TS"
   OWM_TMP="$(mktemp -d "${TMPDIR:-/tmp}/owm-secrets.XXXXXX")"; JAR="$OWM_TMP/cookies.txt"
   printf 'private directory: %s\n' "$OWM_TMP"
   ```

2. Pin the controller's certificate: fetch it once, compare its SHA-256 fingerprint with the one the
   app pinned, and derive the public-key pin from that same file.

   ```sh
   OCHP="${OC#https://}"; OCHP="${OCHP%%/*}"
   case "$OCHP" in *:*) ;; *) OCHP="$OCHP:443";; esac
   openssl s_client -connect "$OCHP" -servername "${OCHP%:*}" </dev/null 2>/dev/null |
     openssl x509 -outform PEM > controller.pem
   FP="$(openssl x509 -in controller.pem -noout -fingerprint -sha256 | cut -d= -f2)"
   printf 'Controller certificate SHA-256: %s\n' "$FP"
   ```

   In the app, open **Settings** / **Ajustes** and copy the value under
   **Trusted certificate (SHA-256)** / **Certificado de confianza (SHA-256)**. The app stores and
   shows the SHA-256 of the certificate's DER encoding as 32 colon-separated upper-case hex pairs,
   the format `openssl` prints, so the two must be identical:

   ```sh
   printf 'Paste the fingerprint shown in Settings: '; read -r APP_FP
   PIN=''
   if [ -n "$FP" ] && [ "$FP" = "$APP_FP" ]; then
     PIN="sha256//$(openssl x509 -in controller.pem -noout -pubkey | openssl pkey -pubin -outform DER |
       openssl dgst -sha256 -binary | openssl base64)"
     printf 'MATCH: PIN=%s\n' "$PIN"
   else
     printf 'MISMATCH (or no certificate): stop, do not continue\n'
   fi
   ```

   - On a mismatch, stop the run and type no secret into this terminal: either the controller's
     certificate changed since you trusted it, or something on the network intercepts the
     connection (the app would refuse it too, with **Controller certificate changed** /
     **El certificado del controlador ha cambiado**).
   - If Settings shows **None** / **Ninguno**, the app has no pin for this Controller URL. If it has
     never connected to it, click **Connect** / **Conectar** now: **Verify the controller certificate** /
     **Verificar el certificado del controlador** shows its **SHA-256 fingerprint** /
     **Huella SHA-256**; trust it only if it equals `FP` and is the one you expect for your
     controller, then copy it from Settings as above. If the app connects without asking, the
     certificate is CA-issued and the app pins nothing: compare `FP` with the certificate your
     browser shows for the Omada web interface instead, and remove `-k` from `ocurl` (step 4).
   - Record `FP` and `PIN` in the record sheet.

3. Credentials, each typed at a prompt (the two secrets are not echoed):

   ```sh
   unset CID CSECRET OUSER OPASS TOKEN OLD CSRF
   printf 'Open API Client ID: ';     read -r CID
   printf 'Open API Client Secret: '; IFS= read -rs CSECRET; echo
   printf 'Controller username: ';    read -r OUSER
   printf 'Controller password: ';    IFS= read -rs OPASS; echo
   ```

4. Paste the functions:

   ```sh
   # Every request goes through ocurl: pinned public key, https only, refuses without a pin
   ocurl() {
     case "$PIN" in
       sha256//?*) ;;
       *) printf 'REFUSED: no certificate pin (0.2, step 3)\n' >&2; return 1;;
     esac
     curl -sS -k --pinnedpubkey "$PIN" --proto '=https' --max-time 60 "$@"
   }

   # Sessions: the secrets reach jq as a one-command prefix assignment, curl on stdin
   retoken() {
     local out
     if ! out="$(OMADAC="$OMADAC" CID="$CID" CSECRET="$CSECRET" jq -nc \
           '{omadacId: env.OMADAC, client_id: env.CID, client_secret: env.CSECRET}' |
         ocurl -H 'Content-Type: application/json' --data-binary @- \
           "$OC/openapi/authorize/token?grant_type=client_credentials")"; then
       printf 'token request failed\n'; return 1
     fi
     TOKEN="$(printf '%s' "$out" | jq -r 'if .errorCode == 0 then (.result.accessToken // "") else "" end')"
     printf '%s' "$out" | jq -c '{errorCode, msg, resultKeys: ((.result | keys?) // null), expiresIn: .result.expiresIn?}'
     [ -n "$TOKEN" ]
   }
   ilogin() {
     local out
     if ! out="$(OUSER="$OUSER" OPASS="$OPASS" jq -nc '{username: env.OUSER, password: env.OPASS}' |
         ocurl -c "$JAR" -H 'Content-Type: application/json' --data-binary @- "$OC/$OMADAC/api/v2/login")"; then
       printf 'login request failed\n'; return 1
     fi
     CSRF="$(printf '%s' "$out" | jq -r 'if .errorCode == 0 then (.result.token // "") else "" end')"
     printf '%s' "$out" | jq -c '{errorCode, msg}'
     [ -n "$CSRF" ]
   }

   # Reads (headers through a process substitution, so no token is ever on a command line)
   oget() {
     [ -n "$TOKEN" ] || { printf 'REFUSED: no access token (run retoken)\n' >&2; return 1; }
     ocurl -H @<(printf 'Authorization: AccessToken=%s\n' "$TOKEN") "$OC/openapi/$1"
   }
   iget() {
     [ -n "$CSRF" ] || { printf 'REFUSED: no internal session (run ilogin)\n' >&2; return 1; }
     ocurl -b "$JAR" -H @<(printf 'Csrf-Token: %s\n' "$CSRF") "$OC/$OMADAC/api/v2/$1"
   }

   # Lists, lookups by name (exactly one match, else a warning) and per-object views
   groups()   { oget "$S/ap-groups?page=1&pageSize=1000"; }
   nets()     { oget "$S2/wireless-network/ssids?page=1&pageSize=1000"; }
   gid()      { groups | jq -r --arg n "$1" '[.result.data[] | select(.name == $n)] |
                  if length == 1 then .[0].id else "NOT EXACTLY ONE (\(length))" end'; }
   nid()      { nets | jq -r --arg n "$1" '[.result.data[] | select(.name == $n)] |
                  if length == 1 then .[0].id else "NOT EXACTLY ONE (\(length))" end'; }
   ginfo()    { groups | jq -c --arg id "$1" '.result.data[] | select(.id == $id) |
                  {name, primary, apNum, ssidNameList, remainingBinding}'; }
   glimits()  { groups | jq -c '.result | {maxSsids2G, maxSsids5G, maxSsids6G, maxSsidsMlo}'; }
   nentry()   { nets | jq -c --arg id "$1" '.result.data[] | select(.id == $id)'; }
   ndetail()  { oget "$S/wireless-network/ssids/$1" | jq -S 'if (.result.pskSetting.securityKey? | type) == "string"
                  then .result.pskSetting.securityKey = "<key hidden>" else . end'; }
   nsec()     { ndetail "$1" | jq -c '.result | {name, band, security, ssidEnable, chooseDevices, apGroupIds,
                  mloEnable, pmfMode, oweEnable, versionPsk: .pskSetting.versionPsk?, encryptionPsk: .pskSetting.encryptionPsk?}'; }
   nbinds()   { oget "$S/wireless-network/ssids/$1/ap-groups" | jq -c '{errorCode, ids: ([.result.apGroups[]?.id] | sort)}'; }
   keystate() { oget "$S/wireless-network/ssids/$1" | PASS="$PASS" jq -r '.result.pskSetting.securityKey? as $k |
                  if $k == null then "absent"
                  elif $k == env.PASS then "in clear (equals PASS)"
                  else "present but not PASS: \($k | tostring | length) characters (masked?)" end'; }
   eap()      { oget "$S/ap-groups/aps?page=1&pageSize=1000" | jq -c --arg mac "$AP_MAC" '.result.data[] |
                  select((.mac | ascii_upcase | gsub(":"; "-")) == $mac) |
                  {source: "open api", name, apGroupId, apGroupName, clientNum, overrideNum}'
                iget "sites/$ISITE/eaps/$AP_MAC" | jq -c '{source: "internal", errorCode,
                  wlanId: .result.wlanId, apGroupName: .result.apGroupName}'; }

   # Run-wide checks
   idsets() {
     local o i
     o="$(groups | jq -c '[.result.data[].id] | sort')"
     i="$(iget "sites/$ISITE/setting/wlans" | jq -c '[.result.data[] |
            select((.deviceType // "ap") | ascii_downcase == "ap") | .id] | sort')"
     if [ -n "$o" ] && [ "$o" = "$i" ]; then printf 'equal: %s ids\n' "$(printf '%s' "$o" | jq length)"
     else printf 'DIFFERENT\nopen api: %s\ninternal: %s\n' "$o" "$i"; fi
   }
   missing() {
     "$2" | jq -c --slurpfile base "$1" '[.result.data[].id] as $now |
       [$base[0].data[] | select(.id as $i | $now | any(.[]; . == $i) | not)]'
   }
   leftovers() {
     { groups; printf '\n'; nets; } | jq -s -c '[(.[0].result.data[] | {kind: "group", id, name}),
         (.[1].result.data[] | {kind: "network", id, name})] |
       map(select(.name | ascii_downcase | startswith("__owm_test_")))'
   }
   survey() {
     local c="$OWM_TMP/catalog.json" g="$OWM_TMP/group-ids.json" id
     nets | jq '{result: {data: [.result.data[] |
         {id, ssidId, name, security, band, ssidEnable, description, chooseDevices}]}}' > "$c" || return 1
     groups | jq '[.result.data[].id]' > "$g" || return 1
     jq -r '.result.data[].id' "$c" | while read -r id; do
       { oget "$S/wireless-network/ssids/$id"; printf '\n'; oget "$S/wireless-network/ssids/$id/ap-groups"; } |
         jq -c -s --arg id "$id" --slurpfile c "$c" --slurpfile g "$g" '
           ($c[0].result.data[] | select(.id == $id)) as $cat
           | (.[0].result // {}) as $det
           | (.[1].result.apGroups? // null) as $bg
           | { name: $cat.name,
               idIsSsidId: ($cat.id == $cat.ssidId),
               security: $cat.security,
               band: $cat.band,
               enableField: {ssidEnable: ($cat.ssidEnable | type), description: ($cat.description | type)},
               chooseDevices: [$cat.chooseDevices, $det.chooseDevices],
               bandAgrees: ($cat.band == $det.band),
               mloEnable: ($det.mloEnable | type),
               errorCodes: [.[0].errorCode, .[1].errorCode],
               bound: (if $bg == null then "not reported" else ($bg | length) end),
               detailIdsEqualBindings: (if $bg == null then null
                 else ((($det.apGroupIds // []) | sort) == ($bg | map(.id) | sort)) end),
               boundNotInGroupList: (if $bg == null then null
                 else ([$bg[].id | select(. as $x | $g[0] | any(.[]; . == $x) | not)] | length) end),
               hasGreEnable: ($det | has("greEnable")),
               hasCondBroadcastCtrl: ($det | has("CondBroadcastCtrl")),
               key: (($det.pskSetting // {}).securityKey | if . == null then "absent"
                 elif type != "string" then "not a string" elif test("^[*•]+$") then "masked" else "present" end) }'
     done
   }
   summary() {
     jq -s '{ networks: length,
       idEqualsSsidId: all(.[]; .idIsSsidId),
       securityCodes: (map(.security) | unique),
       bandValues: (map(.band) | unique),
       enableFieldTypes: (map(.enableField) | unique),
       chooseDevicesDisagree: [.[] | select(.chooseDevices[0] != .chooseDevices[1]) | .name],
       bandDisagree: [.[] | select(.bandAgrees | not) | .name],
       mloEnableTypes: (map(.mloEnable) | unique),
       callErrors: [.[] | select(.errorCodes != [0, 0]) | {name, errorCodes}],
       bindingsNotReported: [.[] | select(.bound == "not reported") | .name],
       detailBindingsDisagree: [.[] | select(.detailIdsEqualBindings == false) | .name],
       boundNotInGroupList: [.[] | select((.boundNotInGroupList // 0) > 0) | .name],
       greEnablePresent: (map(.hasGreEnable) | unique),
       condBroadcastCtrlPresent: (map(.hasCondBroadcastCtrl) | unique),
       keyStates: (map(.key) | unique) }' survey.jsonl
   }

   # Baseline (step 1.2): refused unless no test resource exists and both listings are complete
   mkbaseline() {
     local og on
     if [ -e baseline-groups.json ] || [ -e baseline-nets.json ]; then
       printf 'REFUSED: a baseline already exists in this directory\n'; return 1
     fi
     if [ "$(leftovers)" != '[]' ]; then printf 'REFUSED: leftovers is not [] (or a read failed)\n'; return 1; fi
     og="$(groups)" || { printf 'REFUSED: the group read failed\n'; return 1; }
     on="$(nets)" || { printf 'REFUSED: the network read failed\n'; return 1; }
     printf '%s' "$og" | jq -S '{errorCode, totalRows: .result.totalRows, data: [.result.data[] | {id, name}]}' \
       > baseline-groups.json || { printf 'REFUSED: unreadable group answer\n'; return 1; }
     printf '%s' "$on" | jq -S '{errorCode, totalRows: .result.totalRows, data: [.result.data[] | {id, name}]}' \
       > baseline-nets.json || { printf 'REFUSED: unreadable network answer\n'; return 1; }
     baseline_ok || return 1
     jq -c '{totalRows, rows: (.data | length)}' baseline-groups.json baseline-nets.json
   }
   baseline_ok() {
     local b
     for b in baseline-groups.json baseline-nets.json; do
       if [ ! -s "$b" ]; then printf 'REFUSED: %s is missing or empty (step 1.2)\n' "$b"; return 1; fi
       if ! jq -s -e 'length == 1 and (.[0] | .errorCode == 0
             and (.totalRows | type) == "number" and (.data | type) == "array"
             and (.data | length) == .totalRows
             and all(.data[]; (.id | type) == "string" and (.id | length) > 0))' "$b" >/dev/null 2>&1; then
         printf 'REFUSED: %s is not one complete, successful listing\n' "$b"; return 1
       fi
     done
     return 0
   }
   notinbaseline() {
     jq -s -e --arg id "$1" 'length == 2 and all(.[]; (.data | type) == "array" and all(.data[]; .id != $id))' \
       baseline-groups.json baseline-nets.json >/dev/null 2>&1
   }
   freshtest() {
     local out
     case "$1" in
       group)   out="$(groups)" || return 1;;
       network) out="$(nets)" || return 1;;
       *) return 1;;
     esac
     printf '%s' "$out" | jq -e --arg id "$2" --arg t "$T" '.errorCode == 0
       and ($t | test("^__OWM_TEST_[0-9]{12}$"))
       and ([.result.data[] | select(.id == $id)] | length == 1
            and (.[0].name | type) == "string"
            and (.[0].name | ascii_downcase | startswith($t | ascii_downcase)))' >/dev/null 2>&1
   }

   # Captured ids: each with its kind, refused for a baseline id or a resource not named like this run's
   capture() {
     case "$1" in group|network) ;; *) printf 'REFUSED: use capture group <id> or capture network <id>\n'; return 1;; esac
     case "$2" in ""|*[!0-9A-Za-z_-]*) printf 'REFUSED: not an id: %s\n' "$2"; return 1;; esac
     baseline_ok || return 1
     if ! notinbaseline "$2"; then printf 'REFUSED: %s is in the baseline, or a baseline cannot be read\n' "$2"; return 1; fi
     if ! freshtest "$1" "$2"; then printf 'REFUSED: a fresh read does not list %s as a %s of this run\n' "$2" "$1"; return 1; fi
     if ! jq -nc --arg k "$1" --arg id "$2" '{kind: $k, id: $id}' >> captured-ids.jsonl; then
       printf 'REFUSED: could not write captured-ids.jsonl\n'; return 1
     fi
     printf 'captured %s %s\n' "$1" "$2"
   }
   guard() {
     case "$1" in group|network) ;; *) printf 'REFUSED: the kind must be group or network\n'; return 1;; esac
     case "$2" in ""|*[!0-9A-Za-z_-]*) printf 'REFUSED: not an id: %s\n' "$2"; return 1;; esac
     baseline_ok || return 1
     if ! jq -s -e --arg k "$1" --arg id "$2" 'any(.[]; .kind == $k and .id == $id)' captured-ids.jsonl >/dev/null 2>&1; then
       printf 'REFUSED: %s was not captured in this run as a %s\n' "$2" "$1"; return 1
     fi
     if ! notinbaseline "$2"; then printf 'REFUSED: %s is in the baseline, or a baseline cannot be read\n' "$2"; return 1; fi
     if ! freshtest "$1" "$2"; then printf 'REFUSED: a fresh read does not list %s as a %s of this run\n' "$2" "$1"; return 1; fi
     return 0
   }

   # The only writes: each one guarded; none can reach a production group or network
   gcreate() {
     local out id
     LAST_ID=''
     if ! jq -n -e --arg n "$1" --arg t "$T" \
         '($t | test("^__OWM_TEST_[0-9]{12}$")) and ($n | ascii_downcase | startswith($t | ascii_downcase))' >/dev/null 2>&1; then
       printf 'REFUSED: a test group name must start with %s\n' "$T"; return 1
     fi
     baseline_ok || return 1
     if ! out="$(jq -nc --arg n "$1" '{name: $n}' |
         ocurl -X POST -H @<(printf 'Authorization: AccessToken=%s\n' "$TOKEN") \
           -H 'Content-Type: application/json' --data-binary @- "$OC/openapi/$S/ap-groups")"; then
       printf 'POST failed (see the curl error); check with leftovers\n'; return 1
     fi
     printf '%s\n' "$out" | jq -c '{errorCode, msg, result}'
     id="$(printf '%s' "$out" | jq -r 'if .errorCode == 0 then (.result.id // "") else "" end')"
     if [ -n "$id" ]; then capture group "$id" && LAST_ID="$id"; fi
   }
   ndisable() {
     local out
     guard network "$1" || return 1
     if ! out="$(printf '%s' '{"ssidEnable":false}' |
         ocurl -X PATCH -H @<(printf 'Authorization: AccessToken=%s\n' "$TOKEN") \
           -H 'Content-Type: application/json' --data-binary @- "$OC/openapi/$S/wireless-network/ssids/$1/enable")"; then
       printf 'PATCH failed (see the curl error)\n'; return 1
     fi
     printf '%s\n' "$out" | jq -c '{errorCode, msg}'
   }
   gdelete() {
     local coll out
     case "$1" in
       group)   coll='ap-groups';;
       network) coll='wireless-network/ssids';;
       *) printf 'REFUSED: use gdelete group <id> or gdelete network <id>\n'; return 1;;
     esac
     guard "$1" "$2" || return 1
     if ! out="$(ocurl -X DELETE -H @<(printf 'Authorization: AccessToken=%s\n' "$TOKEN") "$OC/openapi/$S/$coll/$2")"; then
       printf 'DELETE failed (see the curl error); check with leftovers\n'; return 1
     fi
     printf '%s\n' "$out" | jq -c '{errorCode, msg}'
   }
   eaprestore() {
     local out
     case "$ORIG_GROUP_ID" in ""|*[!0-9A-Za-z_-]*) printf 'REFUSED: ORIG_GROUP_ID is not set (1.1)\n'; return 1;; esac
     if ! jq -e --arg id "$ORIG_GROUP_ID" 'any(.data[]; .id == $id)' baseline-groups.json >/dev/null 2>&1; then
       printf 'REFUSED: ORIG_GROUP_ID is not a group of the baseline\n'; return 1
     fi
     [ -n "$CSRF" ] || { printf 'REFUSED: no internal session (run ilogin)\n'; return 1; }
     if ! out="$(jq -nc --arg id "$ORIG_GROUP_ID" '{wlanId: $id}' |
         ocurl -X PATCH -b "$JAR" -c "$JAR" -H @<(printf 'Csrf-Token: %s\n' "$CSRF") \
           -H 'Content-Type: application/json' --data-binary @- "$OC/$OMADAC/api/v2/sites/$ISITE/eaps/$AP_MAC")"; then
       printf 'PATCH failed (see the curl error)\n'; return 1
     fi
     printf '%s\n' "$out" | jq -c '{errorCode, msg}'
   }

   # Close: log out, delete the private directory, forget every secret and every helper
   kitclose() {
     if [ -n "$CSRF" ]; then
       ocurl -o /dev/null -X POST -b "$JAR" -H @<(printf 'Csrf-Token: %s\n' "$CSRF") "$OC/$OMADAC/api/v2/logout"
     fi
     case "$OWM_TMP" in *owm-secrets.*) [ -d "$OWM_TMP" ] && rm -rf "$OWM_TMP";; esac
     unset CID CSECRET OUSER OPASS TOKEN OLD CSRF PASS JAR OWM_TMP PIN APP_FP LAST_ID
     unset -f ocurl retoken ilogin oget iget groups nets gid nid ginfo glimits nentry ndetail nsec nbinds \
       keystate eap idsets missing leftovers survey summary mkbaseline baseline_ok notinbaseline freshtest \
       capture guard gcreate ndisable gdelete eaprestore kitclose
     printf 'probe kit closed\n'
   }
   ```

5. Sessions and site ids:

   ```sh
   OMADAC="$(ocurl "$OC/api/info" | jq -r '.result.omadacId // empty')"; printf 'omadacId=%s\n' "$OMADAC"
   retoken     # prints errorCode, msg, the answer's keys and expiresIn, never the token
   ilogin      # prints errorCode and msg, never the CSRF token
   oget "v1/$OMADAC/sites?page=1&pageSize=100" | jq -c '.result.data[] | {siteId, name}'
   iget "sites?currentPage=1&currentPageSize=100" | jq -c '.result.data[] | {id, name}'
   SITE='…'    # Open API siteId of the site the app is connected to
   ISITE='…'   # internal id of the same site
   S="v1/$OMADAC/sites/$SITE"; S2="v2/$OMADAC/sites/$SITE"
   ```

   An Open API answer with a token error later in the run: `retoken`. An internal answer with a
   session error: `ilogin`. Run `retoken`, `ilogin` and `gcreate` on their own, never in a pipeline
   (they set shell variables).

- **Record:** `FP`, `PIN`, `SITE` and `ISITE`. ☐ pass ☐ fail

### 0.3 Connect and turn management access on

- **Do:** **Connect** / **Conectar**. If no management credentials are saved yet, open **AP groups** /
  **Grupos de AP** first. Then open **Settings** / **Ajustes**, fill **Client ID** / **Client ID** and
  **Client Secret** / **Client Secret** under **Management access (optional)** /
  **Acceso de gestión (opcional)**, click **Save** / **Guardar**, reopen Settings and click
  **Test management access** / **Probar el acceso de gestión**.
- **Observe:** before the credentials, the banner reads
  **Open API credentials are not configured — viewing is available. Add them in Settings → Management access.** /
  **No hay credenciales de Open API configuradas — puedes consultar los datos. Añádelas en Ajustes → Acceso de gestión.**
  Save accepts the Client ID (no
  **The Client ID can only contain letters, digits, dots, hyphens and underscores (up to 128 characters).** /
  **El Client ID solo puede tener letras, números, puntos, guiones y guiones bajos (hasta 128 caracteres).**).
  The test reads **Management access works: every check passed.** /
  **El acceso de gestión funciona: se superaron todas las comprobaciones.** After closing Settings the
  banner is gone and the AP groups view offers **New group** / **Nuevo grupo**.
- **If the test fails:** record the line verbatim, including the codes in parentheses, then run 5.1–5.3
  for the details and stop (every later step needs management access). The likely lines:
  **The controller rejected the Client ID or the Client Secret.** /
  **El controlador rechazó el Client ID o el Client Secret.** (credentials or error codes, 5.1);
  **Could not get an Open API access token (no answer, or an unexpected one). Check that the Open API is enabled in the controller.** /
  **No se pudo obtener un token de acceso de Open API (sin respuesta o con una respuesta inesperada). Comprueba que Open API está activado en el controlador.**
  (token endpoint, 5.1);
  **The Open API application cannot see the connected site. Check which sites it can access in the controller.** /
  **La aplicación de Open API no ve el sitio conectado. Revisa a qué sitios tiene acceso en el controlador.** (5.2);
  **The Open API shows different AP groups than the controller, so management stays off.** /
  **Open API muestra grupos de AP distintos de los del controlador, así que la gestión queda desactivada.** (5.3).
- **Record:** the test's result line; whether Settings showed the session-only note for the secret.
  ☐ pass ☐ fail

### 0.4 The managed Wi-Fi network list loads

- **Do:** open **Wi-Fi networks** / **Redes Wi-Fi**.
- **Observe:** every network shows its state, security, bands and scope. Note any row reading
  **State unknown** / **Estado desconocido**, **Security unknown** / **Seguridad desconocida**,
  **Bands unknown** / **Bandas desconocidas** or **Unknown scope** / **Alcance desconocido**.
- **If an error shows instead of the list** (for example
  **The controller could not send the Wi-Fi networks.** / **El controlador no pudo enviar las redes Wi-Fi.**
  with codes in parentheses): one detail or bindings call failed, which fails the whole read — most
  likely the bindings call for an "All access points" network. Record the line, run 5.6b and 5.9 to
  find the failing network, then do Steps 1–2, skip to Step 8 and finish (network steps are
  impossible).
- **Record:** the rows with an unknown value, or the error line. ☐ pass ☐ fail

## Step 1 — Snapshot (before any change)

### 1.1 EAP Carpio's group

- **Do:** in **Access points** / **Puntos de acceso**, find EAP Carpio and click its row to open
  **AP details** / **Detalles del AP**. *Probe:* `eap`
- **Observe:** the app's group (normally `A_VIRUS`) equals `apGroupName` in both probe lines, and the
  Open API `apGroupId` equals the internal `wlanId`.
- **Record:** `ORIG_GROUP_NAME='…'; ORIG_GROUP_ID='…'` (and in the record sheet). ☐ pass ☐ fail

### 1.2 Baseline of groups and networks

- *Probe:*

  ```sh
  leftovers                                   # must print [] before the baseline is taken
  mkbaseline                                  # writes baseline-groups.json and baseline-nets.json
  groups | jq -c '[.result.data[] | select(.id | test("^[0-9A-Fa-f]{24}$") | not) | {id, name}]'
  ```

- **Observe:** `leftovers` prints `[]` (otherwise an earlier run left `__OWM_TEST_` resources: delete
  them in the app first, networks before groups, checking each id with `nid` / `gid`). `mkbaseline`
  prints `totalRows` and `rows` for the groups, then for the networks, equal in each line; it refuses
  (`REFUSED: …`) while `leftovers` is not `[]`, after a failed read, or when a list is incomplete. A
  refusal stops the run (nothing has changed yet): without a complete baseline the delete guard
  cannot tell production ids from test ids. The counts match the sidebar counts of
  **AP groups** / **Grupos de AP** and **Wi-Fi networks** / **Redes Wi-Fi**. The id check prints `[]`; a group listed there shows the note
  **This group's id has an unexpected format, so the app cannot rename or delete it.** /
  **El identificador de este grupo tiene un formato inesperado: la aplicación no puede cambiarle el nombre ni eliminarlo.**
- **Record:** the two counts; any group with an unexpected id. ☐ pass ☐ fail

### 1.3 EAP Carpio's per-AP overrides (field names only)

- *Probe:* `iget "sites/$ISITE/eaps/$AP_MAC" | jq '.result.ssidOverrides | if type == "array" then {count: length, fields: (map(keys) | add | unique)} else {type: type} end'`
- **Observe:** the list's field names (never copy the values: an entry may hold a per-AP password).
  The app's AP details say that per-AP overrides are not shown.
- **Record:** the field names, so the app can later read overrides through a validated shape.
  ☐ pass ☐ fail

### 1.4 Client counts

- **Do:** compare EAP Carpio's **Clients** / **Clientes** in its AP details, the `clientNum` of the `eap`
  probe and the Omada web interface; do the same for two other access points in the
  **Access points** / **Puntos de acceso** list.
- **Record:** whether the internal device list reports client counts and whether they match.
  ☐ pass ☐ fail

## Step 2 — Create the empty test group

### 2.1 Create `$T`

- **Do:** `printf '%s' "$T" | pbcopy`. In **AP groups** / **Grupos de AP**, click **New group** /
  **Nuevo grupo**, paste into **Group name** / **Nombre del grupo**, click **Create group** /
  **Crear grupo**. Do not refresh.
- **Observe:** the toast **Group "…" created.** / **Se creó el grupo "…".** The group is in the list
  at once with **No APs** / **Sin AP** and **No Wi-Fi networks — silences these APs** /
  **Sin redes Wi-Fi — silencia estos AP**; in **Access points** / **Puntos de acceso** it is a
  destination under **Silence** / **Silenciar**.
- *Probe:* `GROUP_A_ID="$(gid "$T")"; capture group "$GROUP_A_ID"; idsets`
- **Record:** `GROUP_A_ID`; `idsets` prints `equal` with one more id than the baseline. ☐ pass ☐ fail

### 2.2 Read the new group

- *Probe:*

  ```sh
  ginfo "$GROUP_A_ID"; glimits
  iget "sites/$ISITE/setting/wlans" | jq -c --arg id "$GROUP_A_ID" '.result.data[] | select(.id == $id) | .remainingBinding'
  ```

- **Observe:** `apNum` 0, `ssidNameList` `[]`, `primary` false. The Open API `remainingBinding` keys
  (documented: `0` = 2.4 GHz, `1` = 5 GHz, `2` = 6 GHz; is there an MLO key?), the `maxSsids*`
  limits, and the internal `remainingBinding` keys (`2.4GHz`, `5GHz`, `6GHz`, `mlo` in the 2026-10-06
  findings). In the app, the group's **Per-band capacity** / **Capacidad por banda** shows the same
  values (e.g. **8 of 8 free** / **8 libres de 8**); the MLO row reads
  **Not reported (limit: 2)** / **No informado (límite: 2)** unless the Open API reports an MLO key.
  **Delete** / **Eliminar** is enabled with no reason under it, and there is no **Default** /
  **Predeterminado** badge.
- **Record:** both `remainingBinding` objects and the limits. ☐ pass ☐ fail

### 2.3 Test management access after a write

- **Do:** **Settings** / **Ajustes** → **Test management access** / **Probar el acceso de gestión**.
- **Observe:** still **Management access works: every check passed.** /
  **El acceso de gestión funciona: se superaron todas las comprobaciones.** (the id sets still match
  after a create; the app does not re-check them after its own writes).
- **Record:** the result line. ☐ pass ☐ fail

### 2.4 Group-name limits

- **Do:** prepare the names, then for each one: copy it, select `$T`, **Rename** / **Cambiar nombre**,
  paste, confirm with **Rename** / **Cambiar nombre**.

  ```sh
  N128U="${T}_$(printf 'ñ%.0s' {1..104})"   # 128 characters, 232 UTF-8 bytes
  N128A="${T}_$(printf 'x%.0s' {1..104})"   # 128 ASCII characters
  NMIX="${T}_áé€😀"                          # accented letters, euro sign, emoji
  printf '%s' "$N128U" | pbcopy              # then $N128A, then $NMIX
  ```

- **Observe:** for each name, the toast **The group is now called "…".** /
  **El grupo se llama ahora "…".** or the dialog's error line (record it with its codes);
  `ginfo "$GROUP_A_ID" | jq -r .name` equals what you pasted. Then `printf '%s' "${N128A}x" | pbcopy`
  (129 characters): the app refuses before sending with
  **The name can have at most 128 characters.** / **El nombre puede tener como máximo 128 caracteres.**
- **Do:** rename the group back to `$T` (`printf '%s' "$T" | pbcopy`).
- **Record:** which names the controller accepted (does it count characters or bytes; which
  characters does it refuse). ☐ pass ☐ fail

### 2.5 Duplicate group names (write probe)

- **Do:** in the app, try **New group** / **Nuevo grupo** with `$T` in lower case: it is refused
  before sending with **Another AP group already has this name (ignoring case).** /
  **Otro grupo de AP ya tiene este nombre (sin distinguir mayúsculas).** Cancel. *Write probe:*

  ```sh
  TL="$(printf '%s' "$T" | tr '[:upper:]' '[:lower:]')"
  gcreate "$T"
  gcreate "$TL"
  ```

- **Observe:** the exact duplicate is refused (documented errorCode -33200). An answer with
  `errorCode` 0 created a group, and `gcreate` captured its id (`captured group …`): delete it at
  once with `gdelete group <that id>` (when the answer has no id, `capture group "$(gid "$TL")"`
  first); `leftovers` then lists only `$T`.
- **Not provoked on purpose:** -33201 (the controller's group limit; it would need the limit filled)
  and -33203 (deleting the default group; it would put the default group at risk). The app maps them
  to **The controller's AP group limit has been reached.** /
  **Se alcanzó el límite de grupos de AP del controlador.** and
  **The default group cannot be deleted.** / **El grupo predeterminado no se puede eliminar.**
- **Record:** both answers; whether the controller's duplicate rule ignores case. ☐ pass ☐ fail

### 2.6 Helper group `${T}_B` (write probe)

A second empty test group, used only to check binding changes (5.6a) and the delete of a bound
network (7.2).

- *Write probe:*

  ```sh
  gcreate "${T}_B"; GROUP_B_ID="$LAST_ID"
  gid "${T}_B"; idsets; ginfo "$GROUP_B_ID"
  ```

- **Observe:** the answer is `errorCode` 0 with `result.id` (a create without `apMacs` is accepted
  and returns the id) and `gcreate` captured it; `gid` prints the same id; `idsets` is `equal`. In
  the app, after **Refresh** / **Actualizar**, `${T}_B` is under **Silence** / **Silenciar**. If the
  answer had no id: `GROUP_B_ID="$(gid "${T}_B")"; capture group "$GROUP_B_ID"`.
- **Record:** `GROUP_B_ID`, the answer's shape, `remainingBinding`. ☐ pass ☐ fail

## Step 3 — Create the disabled WPA-Personal test network

### 3.1 Create network `$T` bound only to group `$T`

- **Do:** `PASS="owm-$TS-a"; printf '%s' "$PASS" | pbcopy`. In **Wi-Fi networks** /
  **Redes Wi-Fi** click **New network** / **Nueva red**: **Network name (SSID)** /
  **Nombre de la red (SSID)** `$T`; **Security** / **Seguridad** **WPA-Personal** / **WPA-Personal**;
  **Bands** / **Bandas** **2.4 GHz** / **2,4 GHz** and **5 GHz** / **5 GHz** (the defaults); paste the
  password into **Network password** / **Contraseña de la red** and **Type the password again** /
  **Repite la contraseña**; under **AP groups that broadcast it** / **Grupos de AP que la emiten**
  tick only `$T`; leave **Enable after creating** / **Activar después de crearla** unticked; click
  **Create network** / **Crear red**.
- **Observe:** the toast **Network "…" created (disabled).** / **Se creó la red "…" (desactivada).**
  The list shows it **Disabled** / **Desactivada**, **WPA-Personal** / **WPA-Personal**, scope
  **1 group** / **1 grupo** · **No APs** / **Sin AP**; its details show the password **Set** /
  **Configurada** and **Broadcast on** / **Se emite en** lists `$T`.
- *Probe:* `NET_ID="$(nid "$T")"; capture network "$NET_ID"`
- **Record:** `NET_ID`. ☐ pass ☐ fail

### 3.2 Read the network and the group

- *Probe:* `nentry "$NET_ID"; nsec "$NET_ID"; nbinds "$NET_ID"; keystate "$NET_ID"; ginfo "$GROUP_A_ID"`
- **Observe:**
  - catalog entry: which enable field is present and `false` (`ssidEnable`, the boolean
    `description`, or both); `chooseDevices` 1; `band` 3; `id` equal to `ssidId`;
  - detail: `ssidEnable` false, `chooseDevices` 1, `apGroupIds` `[GROUP_A_ID]`, `mloEnable` a
    boolean, and the app's create defaults `versionPsk` 2 (WPA2-PSK) and `encryptionPsk` 3 (AES);
    `pmfMode` as the controller set it;
  - bindings: `errorCode` 0 and exactly `[GROUP_A_ID]`;
  - `keystate`: absent, in clear or masked;
  - group `$T`: `ssidNameList` lists the network although it is disabled; `remainingBinding` is one
    lower than in 2.2 for 2.4 GHz and 5 GHz and unchanged for 6 GHz (the app's **Per-band capacity** /
    **Capacidad por banda** agrees after **Refresh** / **Actualizar**).
- **Record:** the enable field, `pmfMode`, `keystate`, both `remainingBinding` changes. ☐ pass ☐ fail

### 3.3 Create-and-enable path (`${T}_2`, deleted at once)

- **Do:** **New network** / **Nueva red**: name `${T}_2`, WPA-Personal, **2.4 GHz** / **2,4 GHz**
  only, the same password, group `$T` only, tick **Enable after creating** /
  **Activar después de crearla** (group `$T` has no access point, so nothing broadcasts it), click
  **Create network** / **Crear red**.
- **Observe:** the toast **Network "…" created and enabled.** / **Se creó y se activó la red "…".**,
  or **Network "…" was created but is still disabled: the controller did not say which network is the new one, so it could not be enabled. Enable it from its details.** /
  **Se creó la red "…", pero sigue desactivada: el controlador no indicó cuál es la red nueva, así que no se pudo activar. Actívala desde sus detalles.**
  *Probe:* `NET2_ID="$(nid "${T}_2")"; capture network "$NET2_ID"; nsec "$NET2_ID"` (`ssidEnable` true
  after the first toast).
- **Do:** select `${T}_2`, **Delete** / **Eliminar**; **Delete the network** / **Eliminar la red**
  lists the group `$T`; click **Delete network** / **Eliminar red**.
- **Observe:** the toast **Network "…" deleted.** / **Se eliminó la red "…".**; `nentry "$NET2_ID"`
  prints nothing; `ginfo "$GROUP_A_ID"` is back to the 3.2 values.
- **Record:** which create toast appeared (it tells whether the app found the new network's id).
  ☐ pass ☐ fail

### 3.4 Duplicate network names

- **Do:** **New network** / **Nueva red** with exactly `$T` again (WPA-Personal, 2.4 GHz, the same
  password, group `${T}_B` only, not enabled), then once more with `$TL` (same settings).
- **Observe:** each one is refused with
  **The controller already has a network with this name (or it is the emergency network's name).** /
  **El controlador ya tiene una red con este nombre (o es el nombre de la red de emergencia).**
  and its codes (e.g. -33219 or -33231), or created. A duplicate of `$T` that was created: find its id
  with `nets | jq -c --arg n "$T" '[.result.data[] | select(.name == $n) | .id]'`, run
  `capture network <id>` for the id that is not `NET_ID` and delete it with `gdelete network <id>`
  (the app shows two identical names, so delete it by id only). A created `$TL`:
  `capture network "$(nid "$TL")"`, then delete it in the app or with `gdelete network <id>`.
- **Record:** both outcomes with codes: are exact duplicates refused across different AP groups, and
  does case matter. ☐ pass ☐ fail

## Step 4 — Edit, change the password, toggle enable (group `$T` still empty)

The app's derivation of the security settings, for comparison with what the controller reports
(`nsec`): `versionPsk` 4 = WPA2-PSK/WPA3-SAE (WPA3-SAE on 6 GHz only), 2 = WPA2-PSK;
`encryptionPsk` 3 = AES; `pmfMode` 1 = Mandatory, 2 = Capable, 3 = Disabled.

| Result of the save | `versionPsk` | `encryptionPsk` | `pmfMode` | `oweEnable` |
|---|---|---|---|---|
| WPA-Personal, 6 GHz only | 4 | 3 | 1 | false |
| WPA-Personal, 6 GHz and 2.4 / 5 GHz | 4 | 3 | 2 | false |
| WPA-Personal, no 6 GHz | kept if 1–4, else 2 | 3 with `versionPsk` 4; else kept if 1 or 3, else 3 | 2 with `versionPsk` 4; else kept if 2 or 3, else 2 | false |
| Open, with 6 GHz | — | — | 1 | true |
| Open, no 6 GHz, OWE on | — | — | 1 | kept |
| Open, no 6 GHz, OWE off or absent | — | — | 3 | kept |

An edit of the name or the password alone sends every one of these exactly as the detail reports it.
*Probe, before starting:* `ndetail "$NET_ID" > detail-0.json`

### 4.1 Rename through Edit (is the save a merge?)

- **Do:** select the network, **Edit** / **Editar**, set the name to `${T}_E`, paste `$PASS` into
  both password fields (every save of a WPA-Personal network needs it), **Review changes** /
  **Revisar los cambios**.
- **Observe:** **Review the changes** / **Revisar los cambios** lists **Name** / **Nombre**
  `$T → ${T}_E` and **Devices that saved the network under its old name will have to join the new name.** /
  **Los dispositivos que guardaron la red con su nombre anterior tendrán que conectarse al nuevo nombre.**
  Click **Save changes** / **Guardar cambios**: the toast **Changes to "…" saved.** /
  **Se guardaron los cambios de "…".**
- *Probe:*

  ```sh
  ndetail "$NET_ID" > detail-1.json; diff detail-0.json detail-1.json; nbinds "$NET_ID"
  jq -c '.result | {greEnable: has("greEnable"), CondBroadcastCtrl: has("CondBroadcastCtrl")}' detail-1.json
  ```

- **Observe:** only `name` differs: the network is still disabled, still bound to `$T`, and its rate
  limits, schedules and every other setting are unchanged (the app sends the detail's documented
  basic-config fields back; an omitted optional field must not be reset).
- **Record:** every other difference; whether the detail has `greEnable` and `CondBroadcastCtrl`.
  ☐ pass ☐ fail

### 4.2 Bands, WPA mode and PMF

- **Do (a):** **Edit** / **Editar**, tick **6 GHz** / **6 GHz** (keep 2.4 and 5), paste `$PASS`
  twice, **Review changes** / **Revisar los cambios**, **Save changes** / **Guardar cambios**.
  *Probe:* `nsec "$NET_ID"`
- **Observe (a):** saved, or refused with a message and codes. The table above expects
  `versionPsk` 4, `encryptionPsk` 3, `pmfMode` 2, `oweEnable` false.
- **Do (b), web UI then app:** in the Omada web interface set the test network's PMF to Mandatory and
  save (`nsec` shows `pmfMode` 1). In the app, **Refresh** / **Actualizar**, **Edit** / **Editar**,
  untick **6 GHz** / **6 GHz**, paste `$PASS` twice, **Review changes** / **Revisar los cambios**.
- **Observe (b):** the review shows
  **Clients connected on the bands you remove will be disconnected.** /
  **Se desconectarán los clientes conectados en las bandas que quitas.** and
  **If this network's PMF (Protected Management Frames) is set to "Mandatory", saving with this security and these bands may lower it to "Capable". Check it in the controller afterwards.** /
  **Si la PMF (protección de tramas de gestión) de esta red está en "Obligatoria", al guardar con esta seguridad y estas bandas puede pasar a "Compatible". Compruébalo después en el controlador.**
  Save; `nsec "$NET_ID"` and the web interface show what the controller kept (the app sends
  `pmfMode` 2 here).
- **Optional (c), web UI only:** note whether the web interface offers WPA2-PSK alone with 6 GHz,
  and the condition it states for Enhanced IoT Connectivity.
- **Record:** the values after each save; whether Mandatory was accepted with WPA2/WPA3 and lowered
  by the band change. ☐ pass ☐ fail

### 4.3 Security switches (the network stays disabled)

- **Do (a):** **Edit** / **Editar**, **Security** / **Seguridad** **Open** / **Abierta**, keep
  2.4 + 5 GHz, **Review changes** / **Revisar los cambios**: the review warns
  **Anyone in range will be able to join without a password.** /
  **Cualquiera que esté al alcance podrá conectarse sin contraseña.** Save. *Probe:* `nsec "$NET_ID"`
  (expected `security` 0, `pmfMode` 3).
- **Do (b):** **Edit** / **Editar**, tick **6 GHz** / **6 GHz**, save. *Probe:* `nsec "$NET_ID"`
  (expected `oweEnable` true, `pmfMode` 1; the app never sends this at creation, where it refuses an
  open network with 6 GHz).
- **Do (c):** **Edit** / **Editar**, **WPA-Personal** / **WPA-Personal**, untick **6 GHz** /
  **6 GHz**, paste `$PASS` twice; the review says
  **Devices will have to join with the password you typed.** /
  **Los dispositivos tendrán que conectarse con la contraseña que has escrito.** Save.
  *Probe:* `nsec "$NET_ID"; keystate "$NET_ID"` (expected `oweEnable` false; compare the rest with
  the table).
- **Record:** `nsec` after each save, and any refusal with its codes. The network is now
  WPA-Personal on 2.4 + 5 GHz, disabled. ☐ pass ☐ fail

### 4.4 Change password and the controller's password rule

For each password below: set it and copy it (`printf '%s' "$PASS" | pbcopy`), select the network,
**Change password** / **Cambiar contraseña**, paste into **Network password** /
**Contraseña de la red** and **Type the password again** / **Repite la contraseña**, click
**Change password** / **Cambiar contraseña**; the confirmation **Confirm the password change** /
**Confirmar el cambio de contraseña** opens on **Cancel** / **Cancelar** and lists the scope; click
**Change password** / **Cambiar contraseña**; the toast reads **The password of "…" was changed.** /
**Se cambió la contraseña de "…".** Then *probe* `keystate "$NET_ID"`.

- (a) `PASS="owm-$TS-b"` — an ordinary password.
- (b) `PASS="  owm $TS c  "` — two leading and two trailing spaces (the app sends them as
  typed). "in clear (equals PASS)" means the controller kept them; 4 characters fewer means it trimmed
  them.
- (c) `PASS="$(printf 'p%.0s' {1..63})"` — 63 characters.
- (d) `printf 'p%.0s' {1..64} | pbcopy` — 64 characters: the app refuses before sending with
  **The password must have 8 to 63 printable ASCII characters (unaccented letters, digits, spaces and symbols).** /
  **La contraseña debe tener de 8 a 63 caracteres ASCII imprimibles (letras sin tilde, números, espacios y símbolos).**
  Cancel.
- (e) Finish with a password you can type on a phone: `PASS="owm-$TS-ok"`.
- **Record:** `keystate` after each change (absent, masked or in clear); whether (b) and (c) were
  accepted. ☐ pass ☐ fail

### 4.5 Enable and disable

- *Probe:* `ndetail "$NET_ID" > detail-2.json`
- **Do:** **Enable** / **Activar**; **Enable the network** / **Activar la red** lists **Scope** /
  **Alcance** and the group `$T`; click **Enable network** / **Activar red**.
- **Observe:** the toast **Network "…" enabled.** / **Se activó la red "…".**; the list shows
  **Enabled** / **Activada**. *Probe at once:*
  `nentry "$NET_ID"; ndetail "$NET_ID" > detail-3.json; diff detail-2.json detail-3.json`: only
  `ssidEnable` changed, and the catalog's enable field flipped.
- **Do:** **Disable** / **Desactivar**, **Disable the network** / **Desactivar la red**,
  **Disable network** / **Desactivar red**: the toast **Network "…" disabled.** /
  **Se desactivó la red "…".** *Probe:* `nentry "$NET_ID"; nsec "$NET_ID"`
- *Write probe (idempotence):* run `ndisable "$NET_ID"` twice (it sends
  `PATCH …/wireless-network/ssids/$NET_ID/enable` with `{"ssidEnable":false}`).
- **Record:** which catalog field flipped; any other difference; both idempotence answers.
  ☐ pass ☐ fail

## Step 5 — The unknowns of spec §5 and the other API checks

### 5.1 §5 row 1 — the Open API token

- *Probe:*

  ```sh
  retoken
  A="$OWM_TMP/answer.json"
  OMADAC="$OMADAC" CID="$CID" jq -nc '{omadacId: env.OMADAC, client_id: env.CID, client_secret: "wrong-secret"}' |
    ocurl -o "$A" -w 'HTTP %{http_code}\n' -H 'Content-Type: application/json' \
      --data-binary @- "$OC/openapi/authorize/token?grant_type=client_credentials"
  jq -c '{errorCode, msg}' "$A"
  OMADAC="$OMADAC" CSECRET="$CSECRET" jq -nc \
      '{omadacId: env.OMADAC, client_id: "wrong-client-id", client_secret: env.CSECRET}' |
    ocurl -o "$A" -w 'HTTP %{http_code}\n' -H 'Content-Type: application/json' \
      --data-binary @- "$OC/openapi/authorize/token?grant_type=client_credentials"
  jq -c '{errorCode, msg}' "$A"
  ocurl -o "$A" -w 'HTTP %{http_code}\n' -H 'Authorization: AccessToken=not-a-token' \
    "$OC/openapi/v1/$OMADAC/sites?page=1&pageSize=1"
  jq -c '{errorCode, msg}' "$A"
  ocurl -o "$A" -w 'HTTP %{http_code}\n' -H @<(printf 'Authorization: %s\n' "$TOKEN") \
    "$OC/openapi/v1/$OMADAC/sites?page=1&pageSize=1"
  jq -c '{errorCode, msg}' "$A"
  ```

- **Optional, expired token:** `OLD="$TOKEN"`, wait `expiresIn` seconds plus a minute, then
  `ocurl -H @<(printf 'Authorization: AccessToken=%s\n' "$OLD") "$OC/openapi/v1/$OMADAC/sites?page=1&pageSize=1" | jq -c '{errorCode, msg}'`
- **Optional, in the app:** save a wrong Client Secret in Settings and run **Test management access** /
  **Probar el acceso de gestión**: expected
  **The controller rejected the Client ID or the Client Secret.** /
  **El controlador rechazó el Client ID o el Client Secret.** Save the right secret again and test
  until it passes.
- **Observe:** the token endpoint, body and `AccessToken=` header work as the app uses them. The app
  assumes: `result.accessToken` plus `expiresIn` (300 s when absent); a bad Client ID or Secret is
  HTTP 401 / 403 or errorCode -44106; a rejected token is HTTP 401 or errorCode -44112 / -44113.
- **Record:** the token answer's keys and `expiresIn`; HTTP status and errorCode of each failure; the
  Client ID's length and characters (0.3 showed the app accepts it). ☐ pass ☐ fail

### 5.2 §5 row 2 — internal site id = Open API `siteId`

- *Probe:* `[ "$SITE" = "$ISITE" ] && echo same || echo DIFFERENT` (both from 0.2).
- **Observe:** `same`, and 0.3 passed.
- **Record:** the result. ☐ pass ☐ fail

### 5.3 §5 row 3 — internal group id = Open API `apGroupId`

- *Probe:* `idsets`
- **Observe:** `equal`; 1.1 showed EAP Carpio's two ids equal; 0.3 passed.
- **Record:** the result. ☐ pass ☐ fail

### 5.4 §5 row 4 — the catalog's enable field

- **Observe:** from 3.2 and 4.5, the field that carries the state (`ssidEnable` or the boolean
  `description`); from 5.9, `enableFieldTypes` for every network. The app reads `ssidEnable` when it
  is a boolean, else `description`, else shows **State unknown** / **Estado desconocido** and offers
  no **Enable** / **Activar** or **Disable** / **Desactivar**.
- **Record:** the field. ☐ pass ☐ fail

### 5.5 §5 row 5 — does the detail return the password in clear?

- **Observe:** `keystate` in 3.2 and 4.4, and `keyStates` in 5.9. The app never forwards it (the
  details show only **Set** / **Configurada**) and asks for the password on every WPA-Personal save.
- **Record:** absent, masked or in clear. ☐ pass ☐ fail

### 5.6 §5 row 6 — bindings and "All access points"

**5.6a Broadcast on with the two test groups** (the network is disabled; both groups are empty).

- *Probe:* `ginfo "$GROUP_B_ID"` (note `remainingBinding`).
- **Do:** in the network's details, **Broadcast on** / **Se emite en** → **Change AP groups** /
  **Cambiar grupos de AP**; tick `${T}_B` (keep `$T`); **Review the change** / **Revisar el cambio**.
- **Observe:** **Reading the current data again…** / **Leyendo de nuevo los datos actuales…** (time
  it), then **Now** / **Ahora** `$T`, **After** / **Después** both, **Added** / **Se añaden** `${T}_B`.
  Click **Save AP groups** / **Guardar grupos de AP**: the toast
  **Network "…" is now broadcast on ….** / **La red "…" se emite ahora en ….**
  *Probe at once:* `nbinds "$NET_ID"; nsec "$NET_ID"; ginfo "$GROUP_B_ID"`: the bindings are exactly
  both ids, the detail's `apGroupIds` the same, `chooseDevices` still 1, and `${T}_B`'s
  `remainingBinding` one lower for 2.4 and 5 GHz with the network in its `ssidNameList`.
- **Do:** **Change AP groups** / **Cambiar grupos de AP**, untick `$T` so only `${T}_B` remains; the
  review shows **Removed** / **Se quitan** `$T`; save.
- **Observe:** `nbinds "$NET_ID"` lists only `GROUP_B_ID` (the call replaced the set; a merge would
  still list `$T`); `ginfo "$GROUP_A_ID"` has the network out of `ssidNameList` and its capacity back.
- **Do:** change back to `$T` only (tick `$T`, untick `${T}_B`) and save; `nbinds "$NET_ID"` →
  `[GROUP_A_ID]`.
- **Record:** replace or merge; whether bindings, detail and capacity changed at once; how long the
  re-read took. ☐ pass ☐ fail

**5.6b Existing "All access points" networks** (production networks are only read).

- **Do:** in **Wi-Fi networks** / **Redes Wi-Fi**, look for a network whose scope is
  **All access points** / **Todos los puntos de acceso**. If there is none, record "none" and skip.
- **Observe:** its **Broadcast on** / **Se emite en** shows
  **The app does not change where a network on all access points is broadcast (it never turns it into a list of AP groups): to limit it to some groups, use the controller.** /
  **La aplicación no cambia dónde se emite una red que llega a todos los puntos de acceso (nunca la convierte en una lista de grupos de AP): para limitarla a algunos grupos, hazlo en el controlador.**
  and no **Change AP groups** / **Cambiar grupos de AP**.
  *Probe:* `ALL_ID="$(nid '<its name>')"; nsec "$ALL_ID"; nbinds "$ALL_ID"` and
  `groups | jq -c --arg n '<its name>' '[.result.data[] | select(any(.ssidNameList[]?; . == $n)) | .name] | length'`
- **Record:** `chooseDevices` (expected 0); what the bindings call answers (an error, `[]`, every
  group, or no `apGroups`); how many groups list it in `ssidNameList`. ☐ pass ☐ fail

**5.6c Entering and leaving "All access points": not tested on production.** A network on all
access points is bound to every AP group, production groups included (it takes a binding slot in
each, even while disabled), and a binding call with an empty list might do the same. This checklist
therefore never puts the test network on all access points and never sends an empty list: how the
binding call enters and leaves that scope can only be checked on an isolated test site whose groups
are all disposable. The app does not depend on it: it never sends a binding change for such a
network (5.6b) and refuses an empty list before sending.

### 5.7 §5 row 7 — what happens to the access points of a deleted group

The app deletes only empty, unbound, non-default groups; 6.2 checks that Delete is refused while EAP
Carpio and the network are in `$T`. The controller's own behavior when a group with access points is
deleted is deliberately not tested (it could strand EAP Carpio).

- **Record:** the 6.2 result. ☐ pass ☐ fail

### 5.8 Capacity keys and MLO

- **Observe:** from 2.2 and 5.6a: the Open API `remainingBinding` keys (an MLO key?), the internal
  keys, `maxSsidsMlo`, and that each binding took one slot per band of the network.
- **Optional, web UI:** if the web interface offers MLO for the test network, note which security
  modes allow it (does MLO need WPA3 or OWE?), turn MLO on (the network stays disabled) and check
  `nsec "$NET_ID"` (`mloEnable` true) and `ginfo "$GROUP_A_ID"` plus the internal `remainingBinding`
  of 2.2 (does MLO take a slot of its own, under which key?). In the app: **Change AP groups** /
  **Cambiar grupos de AP**, tick `${T}_B`, **Review the change** / **Revisar el cambio**,
  **Save AP groups** / **Guardar grupos de AP**: refused at Save with
  **Not every AP group you add has room for this network: the groups and bands below are full or do not report their capacity (the app never assumes there is room). Nothing was sent.** /
  **No todos los grupos de AP que añades tienen hueco para esta red: los grupos y bandas de abajo están llenos o no informan de su capacidad (la aplicación nunca supone que hay hueco). No se envió nada.**
  with `${T}_B` and **MLO: not reported** / **MLO: no informado**. Cancel, turn MLO off again in
  the web interface, `nsec` → `mloEnable` false.
- **Record:** the keys; MLO's security requirement and slot. ☐ pass ☐ fail

### 5.9 Survey of every network (read-only)

- *Probe:* `time survey > survey.jsonl; summary` (`survey.jsonl` holds no password, only whether one
  is present), and `groups | jq -c '.result.data[] | {name, apNum}'`.
- **Observe** in the summary: `idEqualsSsidId` true; `securityCodes` only 0, 2, 3, 4, 5; `bandValues`
  only 1–7; `enableFieldTypes` (5.4); `chooseDevicesDisagree` and `bandDisagree` empty; `mloEnableTypes`
  only `boolean`; `callErrors` empty (otherwise the app's list fails, 0.4); `bindingsNotReported` only
  "All access points" networks, if any; `detailBindingsDisagree` empty; `boundNotInGroupList` empty;
  `greEnablePresent` and `condBroadcastCtrlPresent`; `keyStates` (5.5). Compare `apNum` of three groups
  (one with a disconnected access point, if any) with their access-point counts in **AP groups** /
  **Grupos de AP**.
- **Record:** the summary (paste it); the `apNum` comparison. ☐ pass ☐ fail

### 5.10 Catalog size, paging and read time

- *Probe:*

  ```sh
  nets   | jq -c '.result | {totalRows, currentSize, returned: (.data | length)}'
  groups | jq -c '.result | {totalRows, currentSize, returned: (.data | length)}'
  ```

- **Do:** in **Wi-Fi networks** / **Redes Wi-Fi**, click **Refresh** / **Actualizar** and time how
  long the list takes to come back.
- **Observe:** `totalRows` of the networks is at most 128 (above that the app shows
  **The complete list of Wi-Fi networks could not be read (or it has more than the app reads at once): a partial list is not shown.** /
  **No se pudo leer la lista completa de redes Wi-Fi (o tiene más de las que la aplicación lee de una vez): no se muestra una lista parcial.**);
  whether `returned` is below `totalRows` (the controller caps the page size; the app follows
  `totalRows` either way).
- **Record:** both lines, the app's read time and the `time survey` of 5.9. ☐ pass ☐ fail

### 5.11 Optional: an Enterprise or PPSK test network

Only if you can create one in the web interface with an existing profile (PPSK without RADIUS needs a
PPSK profile, WPA-Enterprise a RADIUS profile); do not create or change a profile for this.

- **Do, web UI:** create `${T}_P` with that security, disabled, bound only to `${T}_B`.
  *Probe:* `NETP_ID="$(nid "${T}_P")"; capture network "$NETP_ID"`
- **Observe:** after **Refresh** / **Actualizar**, its details show the security (e.g.
  **PPSK without RADIUS** / **PPSK sin RADIUS**), no **Edit** / **Editar** or **Change password** /
  **Cambiar contraseña**, and
  **The app edits only Open and WPA-Personal networks, so the settings and the password of this … network can't be changed here: use the controller. It can still be enabled, disabled or deleted.** /
  **La aplicación solo edita redes abiertas y WPA-Personal, así que aquí no se pueden cambiar los ajustes ni la contraseña de esta red …: hazlo en el controlador. Sí se puede activar, desactivar o eliminar.**
- **Do:** **Enable** / **Activar**, then **Disable** / **Desactivar** (`nsec "$NETP_ID"` after each);
  **Change AP groups** / **Cambiar grupos de AP** to `$T` instead of `${T}_B` (`nbinds "$NETP_ID"`),
  then back to `${T}_B`; **Delete** / **Eliminar** → **Delete network** / **Eliminar red**
  (`nentry "$NETP_ID"` prints nothing).
- **Record:** each action's result. ☐ pass ☐ fail

## Step 6 — Move EAP Carpio into the test group and back

While EAP Carpio is in `$T` it stops broadcasting its usual networks and their clients disconnect.
**Restore in all cases:** if anything below fails, go straight to 6.5, or to
[R.1](#r-emergency-restore-and-clean-up) if the app cannot move it.

### 6.1 Move in

- **Do:** in **Access points** / **Puntos de acceso**, tick EAP Carpio only and pick `$T` in
  **Move selected APs** / **Mover los AP seleccionados** (or: **AP groups** / **Grupos de AP** → `$T`
  → **Move access points here** / **Mover puntos de acceso aquí**, then tick EAP Carpio).
- **Observe:** the preview's **Gains** / **Gana** has the test network and **Loses** / **Pierde** its
  usual networks. Click **Move AP** / **Mover AP**; **Review the move** / **Revisar el movimiento**
  opens on **Cancel** / **Cancelar**; click **Move AP** / **Mover AP**; **Move results** /
  **Resultado del movimiento** shows **Moved** / **Movido**; **Close** / **Cerrar**.
- *Probe:* `eap; ginfo "$GROUP_A_ID"`: both ids are `GROUP_A_ID`; `apNum` 1.
- **Observe:** `$T`'s details list EAP Carpio; the network's scope reads **1 group** / **1 grupo** ·
  **1 AP** / **1 AP**; in **Change AP groups** / **Cambiar grupos de AP** the group `$T` shows 1 access
  point (the app counts from its own access-point list, the controller's `apNum` says 1);
  **Cancel** / **Cancelar**.
- **Record:** the result; any count that differs. ☐ pass ☐ fail

### 6.2 Delete refused while the group is in use

- **Do:** **AP groups** / **Grupos de AP** → `$T`.
- **Observe:** **Delete** / **Eliminar** is disabled with
  **To delete it, first move its access points to another group.** /
  **Para eliminarlo, mueve antes sus puntos de acceso a otro grupo.** and
  **To delete it, first unlink its Wi-Fi networks.** / **Para eliminarlo, desvincula antes sus redes Wi-Fi.**
- **Record:** the reasons shown. ☐ pass ☐ fail

### 6.3 Rename with an access point inside

- **Do:** **Rename** / **Cambiar nombre** `$T` to `${T}_R`.
- **Observe:** the toast **The group is now called "…".** / **El grupo se llama ahora "…".**;
  EAP Carpio's row shows the new name. *Probe:* `eap; ginfo "$GROUP_A_ID"`: still `GROUP_A_ID`,
  `apNum` 1 (a rename sends only the name and must not move access points).
- **Do:** rename it back to `$T`.
- **Record:** the result. ☐ pass ☐ fail

### 6.4 Optional: live clients (a phone or laptop near EAP Carpio)

- **Do:** **Enable** / **Activar** the network (the confirmation lists `$T` and **1 AP** / **1 AP**),
  **Enable network** / **Activar red**. Join `${T}_E` with the phone using `$PASS` (4.4e). If
  `keystate` was "absent" in 4.4b, repeat 4.4b now and try joining with and without the spaces.
- **Observe:** after **Refresh** / **Actualizar**, EAP Carpio's **Clients** / **Clientes** counts the
  phone, as the web interface does.
- **Do:** **Change AP groups** / **Cambiar grupos de AP** to `${T}_B` instead of `$T` and save: does
  the phone lose the network at once? Change back to `$T`, rejoin.
- **Do:** **Disable** / **Desactivar** → **Disable network** / **Desactivar red**: the phone
  disconnects; clients on other access points keep their networks.
- **Optional, if EAP Carpio has a 6 GHz radio:** before disabling, **Edit** / **Editar** to add
  **6 GHz** / **6 GHz** and check whether the phone joins on 6 GHz with WPA3; remove 6 GHz again.
- **End state:** the network **Disabled** / **Desactivada**, bound to `$T`.
- **Record:** each observation. ☐ pass ☐ fail

### 6.5 Move back (always)

- **Do:** **Access points** / **Puntos de acceso**, tick EAP Carpio, pick `$ORIG_GROUP_NAME`,
  **Move AP** / **Mover AP**, confirm in **Review the move** / **Revisar el movimiento**, check
  **Moved** / **Movido**, **Close** / **Cerrar**.
- *Probe:* `eap; ginfo "$GROUP_A_ID"`: both ids equal `ORIG_GROUP_ID`; `apNum` 0.
- **Observe:** EAP Carpio broadcasts its usual networks again (phone or web interface).
- **Record:** the result. ☐ pass ☐ fail

## Step 7 — Unbind and delete the test network

### 7.1 Unbind it from `$T`

- **Do:** **Change AP groups** / **Cambiar grupos de AP**: tick `${T}_B`, untick `$T`,
  **Save AP groups** / **Guardar grupos de AP**.
- **Observe:** **AP groups** / **Grupos de AP** → `$T`: **Delete** / **Eliminar** is enabled with no
  reason. *Probe:* `ginfo "$GROUP_A_ID"`: `ssidNameList` `[]`, `remainingBinding` as in 2.2.
- **Record:** the result. ☐ pass ☐ fail

### 7.2 Delete the network while it is still bound to `${T}_B`

- *Probe first:* `nid "${T}_E"` prints `NET_ID`.
- **Do:** select `${T}_E`, **Delete** / **Eliminar**; **Delete the network** / **Eliminar la red**
  lists the group `${T}_B`; click **Delete network** / **Eliminar red**.
- **Observe:** the toast **Network "…" deleted.** / **Se eliminó la red "…".** *Probe at once:*
  `nentry "$NET_ID"` prints nothing; `ginfo "$GROUP_B_ID"` has an empty `ssidNameList` and its
  2.6 `remainingBinding` back; `missing baseline-nets.json nets` prints `[]`.
- **Record:** whether the group's bindings and capacity updated at once. ☐ pass ☐ fail

## Step 8 — Delete the test groups

- *Probe first:* `gid "$T"` prints `GROUP_A_ID`, `gid "${T}_B"` prints `GROUP_B_ID`.
- **Do:** **AP groups** / **Grupos de AP** → `$T` → **Delete** / **Eliminar** →
  **Delete the group** / **Eliminar el grupo** → **Delete group** / **Eliminar grupo**: the toast
  **Group "…" deleted.** / **Se eliminó el grupo "…".** Then the same for `${T}_B`. If `${T}_B`'s
  Delete is still disabled with **To delete it, first unlink its Wi-Fi networks.** /
  **Para eliminarlo, desvincula antes sus redes Wi-Fi.**, the controller had not updated its
  `ssidNameList` after 7.2: record it, wait, **Refresh** / **Actualizar** and retry.
- *Probe:* `ginfo "$GROUP_A_ID"; ginfo "$GROUP_B_ID"` print nothing; `idsets` is `equal` with the
  baseline count. **Test management access** / **Probar el acceso de gestión** still passes.
- **Record:** the result. ☐ pass ☐ fail

## Step 9 — Confirm nothing is left

- *Probe:*

  ```sh
  leftovers                                  # []
  missing baseline-groups.json groups        # []
  missing baseline-nets.json nets            # []
  eap                                        # both ids = ORIG_GROUP_ID
  ```

- **Do:** search `__OWM_TEST_` in **AP groups** / **Grupos de AP** and in **Wi-Fi networks** /
  **Redes Wi-Fi**: **No groups or networks match "…"** / **Ningún grupo ni red coincide con "…"** and
  **No networks or groups match "…"** / **Ninguna red ni grupo coincide con "…"**.
- **Close the probe kit:** `kitclose`. It logs the internal session out, deletes the private
  directory (the cookie jar and the scratch answers of 5.1 and 5.9), unsets the secrets (`CSECRET`,
  `OPASS`, `TOKEN`, `OLD`, `CSRF`, `PASS`, `CID`, `OUSER`) and `PIN`, and removes every helper; then
  close the terminal window. If the window was closed before `kitclose`, delete the private
  directory printed in 0.2 (`owm-secrets.…`) by hand. Keep the working directory's files
  (baselines, captured ids, survey, diffs, `controller.pem`; no secrets) with this checklist.
- **Record:** the result. ☐ pass ☐ fail

## R. Emergency restore and clean-up

Run at any point, in this order, then finish with Step 9 (which ends with `kitclose`).

1. **EAP Carpio back to its group:** the app (6.5). If the app cannot: the web interface (EAP
   Carpio's AP group), or `eaprestore; eap` (the same internal call the app uses for moves; it
   moves EAP Carpio only to `ORIG_GROUP_ID`, a group of the baseline; run `ilogin` first if it
   reports a session error).
2. **Disable every enabled test network:** the app, or `ndisable <captured id>`.
3. **Delete the test networks:** the app (check the id with `nid` first), or
   `gdelete network <captured id>`.
4. **Delete the test groups** (empty and unbound after 1–3): the app, or
   `gdelete group <captured id>`.
5. **If you stop here** instead of going on to Step 9, close the probe kit with `kitclose`: it
   deletes the private directory and unsets every secret.

If a captured id was lost, `leftovers` lists the `__OWM_TEST_` resources with their kind and id;
run `capture <kind> <id>` for each one before `ndisable` or `gdelete`. Never delete anything
`leftovers` does not list; `gdelete` refuses an id that was not captured in this run, is in the
baseline, or is not named like this run's test resources.

## Part C — TP-Link cloud controllers

A separate run for the optional TP-Link cloud access (inbox item I-1): TP-Link's Account Level Open
API (beta), which reaches the account's on-premises controllers through its Cloud Access tunnel —
here "OC200 Planta 3" and "OC200 Planta 4", on a network you cannot reach directly, and "Omada red
antigua (Proxmox)", the controller of Steps 1–9. It was built against TP-Link's documented contract,
`docs/omada-cloud-openapi.md`, and tested on fixtures and a stubbed main process only: no test, smoke
run or probe of the app contacts any `tplinkcloud.com` host (decision D4, extended by D5–D7). These
steps are for you to run by hand. They check every item of the contract's §11 ("Unverified
behaviors") and the controller switcher's live steps; the [cross-reference](#cross-reference) rows
`C11-…` and `I-1…` map them. Part C needs neither the probe kit of 0.2 nor the baselines of 1.2, so
it can run on its own or after Step 9.

**It needs the portal page.** As of 2026-10-07 TP-Link had not enabled the Open API page of its
Omada cloud portal for the account, so no real credential exists. If C.1 finds no page, record that
and stop: nothing else in Part C can run.

### C.0 Safety rules for the cloud controllers

1. **Disposable resources only**, as in the [safety rules](#safety-rules): every group and network
   Part C creates on a cloud controller is named `__OWM_TEST_<TS>` plus a suffix and is deleted at
   the end of C.11 ([C.R](#cr-clean-up-and-close-always) catches anything left).
2. **One remote access point, optional.** The moves through the tunnel (C.10) use one access point
   of the cloud controller under test that you may silence for a minute (`CAP_NAME`), moved only
   into the empty test group and back. Skip C.10 if the site has none.
3. **A way back.** Before the first write (C.9), open the cloud controller's own web interface from
   the TP-Link cloud portal, so that you can restore `CAP_NAME`'s group and delete test resources
   there if the app cannot.
4. **Secrets.** The cloud kit (C.3) follows the probe kit's rules: the Client Secret and the access
   token live in plain shell variables, typed at a hidden prompt or set by the kit, never exported,
   never on a command line and never in a file of the working directory. It sends the token only to
   the three TP-Link API hosts the app allows, verifies TP-Link's certificates normally (no `-k`, no
   pin) and follows no redirect. Its only write is the optional no-op of C.10.
5. **The configuration file.** Only C.16 touches `~/.omada-wlan-manager/`: it sets `config.json`
   aside for a cloud-only start under a guard that puts it back on every way out of its terminal
   window, and C.R item 5 puts back a backup that is left.

| Item | Value |
|---|---|
| Date, app commit (`git rev-parse --short HEAD`) | |
| Region and its base URL (`CB`) | |
| Credentials `owm-full`, `owm-view`, `owm-throwaway`: validity, organizations, access (C.1) | |
| Each organization: name, `deviceType`, `orgVersion`, `serverHost`, `online` (C.5) | |
| Cloud controller under test (`CORG`) and its site (`CSITE`) | |
| `CAP_NAME`, its MAC (`CAP_MAC`) and its group (`CAP_GROUP`) | |
| Test resources created on the cloud controller | |

### C.1 The portal page and the credentials (§11 item 1)

- *Web UI (TP-Link cloud portal):* sign in with the account that lists the three controllers and
  open *On Premise Systems → Open API* (Account Level Open API).
- **If it is missing:** record it and stop Part C.
- *Web UI:* create three credentials in client credentials mode and keep each Client ID and Client
  Secret in your password manager (never in this checklist or a file):
  - `owm-full`: access **full**, organizations **all**;
  - `owm-view`: access **view only**, organizations **selected**: only the controller you will test
    (`CORG`, e.g. "OC200 Planta 4");
  - `owm-throwaway`: any access, the shortest validity; C.4 deletes it.
- **Observe:** the settings the page offers (documented: name, description, validity 30 / 90 days,
  half a year, one year or permanent; organizations all or selected; access full or view only) and
  whether it shows an `AK-…` API key once (the app does not use one).
- **Record:** the page's path, its settings, each credential's validity and organizations, and each
  Client ID's length and characters (the app accepts 1–128 letters, digits, dots, hyphens and
  underscores). ☐ pass ☐ fail

### C.2 Settings and Test cloud access

- **Do:** connect to the local controller once (**Connect** / **Conectar**): that is how the app
  learns its controller id. Open **Settings** / **Ajustes**, section
  **TP-Link cloud (optional)** / **Nube de TP-Link (opcional)**: **Region** / **Región** of your
  account (e.g. **Europe (EUW)** / **Europa (EUW)**), **Client ID** / **Client ID** and
  **Client Secret** / **Client Secret** of `owm-full`, **Save** / **Guardar**. Reopen Settings and
  click **Test cloud access** / **Probar el acceso a la nube**. (With unsaved cloud edits it answers
  **Save your changes first: the test uses the saved cloud credential.** /
  **Guarda primero los cambios: la prueba usa la credencial de la nube guardada.** and sends
  nothing.)
- **Observe:**
  - The secret field reads **(unchanged)** / **(sin cambios)**. On a computer without secure
    storage, Settings shows the session-only note and the save the toast
    **The cloud Client Secret is kept for this session only.** /
    **El Client Secret de la nube solo se conserva durante esta sesión.**
  - The test reads, for example,
    **Cloud access works: 3 controllers found.** /
    **El acceso a la nube funciona: se encontraron 3 controladores.**, with one row per controller:
    its name, its version (e.g. **Omada 6.3.0.45** / **Omada 6.3.0.45**) and **Available** /
    **Disponible** or the reason it cannot be used.
  - "Omada red antigua (Proxmox)" is marked **This network** / **Esta red**: the local controller's
    `/api/info` id equals its cloud organization's `omadacId` (user decision D6; the switcher hides
    that entry).
  - The certificate section now has the note
    **TP-Link cloud controllers are reached through TP-Link's cloud: their certificate is verified normally, with no pinning and no prompt.** /
    **Los controladores de la nube de TP-Link se alcanzan a través de la nube de TP-Link: su certificado se verifica de la forma habitual, sin fijarlo ni preguntar.**
- **If the test fails:** record its line verbatim, with the codes in parentheses; C.4 shows the raw
  answer.
- **Record:** the result line and each row; whether **This network** / **Esta red** marks the right
  controller. ☐ pass ☐ fail

### C.3 The cloud kit (terminal)

Like the probe kit of 0.2, a set of shell functions (zsh or bash, with `curl` and `jq`) that shows
the raw answers the app never shows. Every function reads, except the token requests and the
optional no-op write `csamegroup` (C.10). Open a new terminal window (in zsh, run
`setopt interactivecomments` first), then:

1. The settings (edit `CB` for your region: `aps1-`, `euw1-` or `use1-omada-northbound`):

   ```sh
   umask 077
   case "$-" in *a*) printf 'STOP: allexport is on; run  set +a  first\n';; esac
   CB='https://euw1-omada-northbound.tplinkcloud.com'   # the account's region (C.2)
   CORG='OC200 Planta 4'                                # the cloud controller under test
   TS="$(date +%Y%m%d%H%M)"; T="__OWM_TEST_$TS"
   mkdir -p "$HOME/owm-live-$TS" && cd "$HOME/owm-live-$TS"
   OWM_CTMP="$(mktemp -d "${TMPDIR:-/tmp}/owm-secrets.XXXXXX")"; A="$OWM_CTMP/answer.json"
   printf 'private directory: %s\n' "$OWM_CTMP"
   ```

2. Paste the functions:

   ```sh
   # A credential's Client ID and Client Secret, typed at a prompt (the secret is not echoed)
   ccred() {
     unset CTOKEN
     printf 'Cloud Client ID: ';     read -r CCID
     printf 'Cloud Client Secret: '; IFS= read -rs CCSECRET; echo
   }

   # Every request: https only, TP-Link's certificate verified normally, no redirect followed
   ccurl() { curl -sS --proto '=https' --max-time 60 "$@"; }

   # The app's serverHost allowlist: exactly one of the three regional API hosts, default port
   cnorm() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -e 's#/$##' -e 's#:443$##'; }
   callowed() {
     case "$1" in
       https://aps1-omada-northbound.tplinkcloud.com) return 0;;
       https://euw1-omada-northbound.tplinkcloud.com) return 0;;
       https://use1-omada-northbound.tplinkcloud.com) return 0;;
     esac
     return 1
   }

   # The account token (get_tokens): prints the answer's codes, keys and expiresIn, never the token
   ctoken() {
     local out
     callowed "$CB" || { printf 'REFUSED: CB is not a TP-Link API host the app allows\n' >&2; return 1; }
     if ! out="$(CCID="$CCID" CCSECRET="$CCSECRET" jq -nc '{client_id: env.CCID, client_secret: env.CCSECRET}' |
         ccurl -H 'Content-Type: application/json' --data-binary @- "$CB/authorize/account/token?type=get_tokens")"; then
       printf 'token request failed\n'; return 1
     fi
     CTOKEN="$(printf '%s' "$out" | jq -r 'if .errorCode == 0 then (.result.accessToken // "") else "" end')"
     printf '%s' "$out" | jq -c '{errorCode, msg, resultKeys: ((.result | keys?) // null),
       tokenType: .result.tokenType?, expiresIn: .result.expiresIn?}'
     [ -n "$CTOKEN" ]
   }
   # A token request that keeps no token: ctokentry wrong-secret, wrong-id or region <aps1|euw1|use1>
   ctokentry() {
     local base="$CB" body
     case "$1" in
       wrong-secret) body="$(CCID="$CCID" jq -nc '{client_id: env.CCID, client_secret: "wrong-secret"}')";;
       wrong-id) body="$(CCSECRET="$CCSECRET" jq -nc '{client_id: "wrong-client-id", client_secret: env.CCSECRET}')";;
       region)
         base="https://$2-omada-northbound.tplinkcloud.com"
         body="$(CCID="$CCID" CCSECRET="$CCSECRET" jq -nc '{client_id: env.CCID, client_secret: env.CCSECRET}')";;
       *) printf 'REFUSED: use ctokentry wrong-secret, wrong-id or region <aps1|euw1|use1>\n' >&2; return 1;;
     esac
     callowed "$base" || { printf 'REFUSED: %s is not a TP-Link API host the app allows\n' "$base" >&2; return 1; }
     printf '%s' "$body" | ccurl -o "$A" -w 'HTTP %{http_code}: ' -H 'Content-Type: application/json' \
       --data-binary @- "$base/authorize/account/token?type=get_tokens" || return 1
     jq -c '{errorCode, msg, resultKeys: ((.result | keys?) // null)}' "$A"
     rm -f "$A"
   }

   # Account-level calls: ccall <path> [curl options]
   ccall() {
     local p="$1"; shift
     [ -n "$CTOKEN" ] || { printf 'REFUSED: no cloud access token (run ctoken)\n' >&2; return 1; }
     callowed "$CB" || { printf 'REFUSED: CB is not a TP-Link API host the app allows\n' >&2; return 1; }
     ccurl -H @<(printf 'Authorization: AccessToken=%s\n' "$CTOKEN") "$@" "$CB/$p"
   }
   orgs() { ccall "v1/organizations?page=${1:-1}&pageSize=${2:-100}"; }

   # corg "<organization name>": selects it for the tunnel calls (OMID, DEVID, SH)
   corg() {
     local row
     OMID=''; DEVID=''; SH=''
     row="$(orgs | jq -c --arg n "$1" '[.result.data[]? | select(.orgName == $n)] |
              if length == 1 then .[0] else empty end')"
     [ -n "$row" ] || { printf 'REFUSED: not exactly one organization named %s\n' "$1"; return 1; }
     OMID="$(printf '%s' "$row" | jq -r '.omadacId // ""')"
     DEVID="$(printf '%s' "$row" | jq -r '.deviceId // ""')"
     SH="$(cnorm "$(printf '%s' "$row" | jq -r '.serverHost // ""')")"
     case "$OMID" in ""|*[!0-9A-Za-z_-]*) printf 'REFUSED: unexpected omadacId\n'; SH=''; return 1;; esac
     case "$DEVID" in ""|*[!0-9A-Za-z_-]*) printf 'REFUSED: unexpected deviceId\n'; SH=''; return 1;; esac
     if ! callowed "$SH"; then
       printf 'REFUSED: serverHost %s is not a TP-Link API host the app allows\n' "$SH"; SH=''; return 1
     fi
     printf 'selected %s (serverHost %s)\n' "$1" "$SH"
   }

   # Controller calls through the tunnel: tcall <path after /openapi/> [curl options]
   tcall() {
     local p="$1"; shift
     [ -n "$CTOKEN" ] || { printf 'REFUSED: no cloud access token (run ctoken)\n' >&2; return 1; }
     callowed "$SH" || { printf 'REFUSED: no organization selected (run corg)\n' >&2; return 1; }
     ccurl -H @<(printf 'Authorization: AccessToken=%s\n' "$CTOKEN") "$@" "$SH/v1/cloudaccess/$DEVID/openapi/$p"
   }
   csites()  { tcall "v1/$OMID/sites?page=1&pageSize=100"; }
   caps()    { tcall "v1/$OMID/sites/$CSITE/ap-groups/aps?page=${1:-1}&pageSize=${2:-100}"; }
   cgroups() { tcall "v1/$OMID/sites/$CSITE/ap-groups?page=1&pageSize=100"; }
   cnets()   { tcall "v2/$OMID/sites/$CSITE/wireless-network/ssids?page=1&pageSize=100"; }

   # Rate limit (C.13): cburst <n> [tunnel] sends n reads at once (the token header sits in the
   # private directory while they run)
   cburst() {
     local i n="${1:-15}" url="$CB/v1/organizations?page=1&pageSize=1" h="$OWM_CTMP/auth-header"
     [ -n "$CTOKEN" ] || { printf 'REFUSED: no cloud access token (run ctoken)\n' >&2; return 1; }
     callowed "$CB" || { printf 'REFUSED: CB is not a TP-Link API host the app allows\n' >&2; return 1; }
     if [ "$2" = tunnel ]; then
       callowed "$SH" || { printf 'REFUSED: no organization selected (run corg)\n' >&2; return 1; }
       url="$SH/v1/cloudaccess/$DEVID/openapi/v1/$OMID/sites?page=1&pageSize=1"
     fi
     printf 'Authorization: AccessToken=%s\n' "$CTOKEN" > "$h" || return 1
     for i in $(seq 1 "$n"); do
       ccurl -o "$OWM_CTMP/burst-$i.json" -w "read $i: HTTP %{http_code}\n" -H @"$h" "$url" &
     done
     wait
     rm -f "$h"
     for i in $(seq 1 "$n"); do jq -c --arg i "$i" '{i: $i, errorCode, msg}' "$OWM_CTMP/burst-$i.json"; done
     rm -f "$OWM_CTMP"/burst-*.json
   }
   # cmixburst: 8 list reads and 4 token requests at once (do token requests count?)
   cmixburst() {
     local i h="$OWM_CTMP/auth-header"
     [ -n "$CTOKEN" ] || { printf 'REFUSED: no cloud access token (run ctoken)\n' >&2; return 1; }
     callowed "$CB" || { printf 'REFUSED: CB is not a TP-Link API host the app allows\n' >&2; return 1; }
     printf 'Authorization: AccessToken=%s\n' "$CTOKEN" > "$h" || return 1
     for i in 1 2 3 4 5 6 7 8; do
       ccurl -o "$OWM_CTMP/mix-read-$i.json" -w "read $i: HTTP %{http_code}\n" -H @"$h" \
         "$CB/v1/organizations?page=1&pageSize=1" &
     done
     for i in 1 2 3 4; do
       CCID="$CCID" CCSECRET="$CCSECRET" jq -nc '{client_id: env.CCID, client_secret: env.CCSECRET}' |
         ccurl -o "$OWM_CTMP/mix-token-$i.json" -w "token $i: HTTP %{http_code}\n" \
           -H 'Content-Type: application/json' --data-binary @- "$CB/authorize/account/token?type=get_tokens" &
     done
     wait
     rm -f "$h"
     for i in "$OWM_CTMP"/mix-*.json; do jq -c --arg f "${i##*/}" '{f: $f, errorCode, msg}' "$i"; done
     rm -f "$OWM_CTMP"/mix-*.json
   }

   # The only cloud write (C.10, optional): sends an access point's CURRENT group id again, read
   # fresh from the controller, so nothing can change
   csamegroup() {
     local mac gid out
     mac="$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]' | tr ':' '-')"
     case "$mac" in
       [0-9A-F][0-9A-F]-[0-9A-F][0-9A-F]-[0-9A-F][0-9A-F]-[0-9A-F][0-9A-F]-[0-9A-F][0-9A-F]-[0-9A-F][0-9A-F]) ;;
       *) printf 'REFUSED: not a MAC address: %s\n' "$1"; return 1;;
     esac
     case "$CSITE" in ""|*[!0-9A-Za-z_-]*) printf 'REFUSED: CSITE is not set (C.8)\n'; return 1;; esac
     gid="$(caps | jq -r --arg mac "$mac" '[.result.data[]? | select((.mac // "" | ascii_upcase | gsub(":"; "-")) == $mac)] |
              if length == 1 then (.[0].apGroupId // "") else "" end')"
     case "$gid" in ""|*[!0-9A-Za-z_-]*) printf 'REFUSED: the access point or its current group id was not read\n'; return 1;; esac
     if ! out="$(jq -nc --arg id "$gid" '{wlanGroupId: $id}' |
         tcall "v1/$OMID/sites/$CSITE/aps/$mac/wlan-group" -X PATCH -H 'Content-Type: application/json' --data-binary @-)"; then
       printf 'PATCH failed (see the curl error)\n'; return 1
     fi
     printf '%s\n' "$out" | jq -c '{errorCode, msg}'
   }

   # Close: delete the private directory, forget every secret and every helper
   ckitclose() {
     case "$OWM_CTMP" in *owm-secrets.*) [ -d "$OWM_CTMP" ] && rm -rf "$OWM_CTMP";; esac
     unset CCID CCSECRET CTOKEN COLD OWM_CTMP A OMID DEVID SH CSITE
     unset -f ccred ccurl cnorm callowed ctoken ctokentry ccall orgs corg tcall csites caps cgroups cnets \
       cburst cmixburst csamegroup ckitclose
     printf 'cloud kit closed\n'
   }
   ```

3. Run `ccred` with `owm-full`'s values, then `ctoken`. Run `ccred`, `ctoken` and `corg` on their
   own, never in a pipeline (they set shell variables). An answer with a token error later in the
   run: `ctoken` again.

- **Record:** nothing yet. ☐ pass ☐ fail

### C.4 The account token (§11 item 2)

- *Probe:*

  ```sh
  ctoken                     # errorCode, msg, the answer's keys, tokenType and expiresIn; never the token
  ctokentry wrong-secret     # HTTP status, errorCode and msg of each failure
  ctokentry wrong-id
  ctokentry region aps1; ctokentry region euw1; ctokentry region use1   # the same credential on each region
  ```

- **Deleted credential:** `ccred` with `owm-throwaway`'s values and `ctoken` (it works); *web UI:*
  delete `owm-throwaway`; `ctoken` again. In the app, save `owm-throwaway` in Settings and run
  **Test cloud access** / **Probar el acceso a la nube**: expected
  **TP-Link says this credential has expired or no longer exists. Create a new one in the TP-Link Omada cloud portal and save it here.** /
  **TP-Link indica que esta credencial ha caducado o ya no existe. Crea otra en el portal de Omada en la nube de TP-Link y guárdala aquí.**
- **Disabled credential, if the portal can disable one:** disable `owm-view`, `ccred` with its
  values, `ctoken`, then enable it again. The app's line for TP-Link's -90113 is
  **TP-Link says this credential is disabled. Enable it in the TP-Link Omada cloud portal, or create a new one.** /
  **TP-Link indica que esta credencial está desactivada. Actívala en el portal de Omada en la nube de TP-Link o crea otra.**
- **Wrong secret in the app:** save `owm-full`'s Client ID with a wrong Client Secret and run
  **Test cloud access** / **Probar el acceso a la nube**: expected
  **TP-Link rejected the Client ID or the Client Secret. Check that both were copied correctly and that the region is right.** /
  **TP-Link rechazó el Client ID o el Client Secret. Comprueba que los copiaste bien y que la región es la correcta.**
  (TP-Link's -90106) or
  **TP-Link rejected the credential (wrong, expired, deleted or disabled). Check it in the TP-Link Omada cloud portal, and check the region.** /
  **TP-Link rechazó la credencial (incorrecta, caducada, eliminada o desactivada). Revísala en el portal de Omada en la nube de TP-Link y comprueba la región.**
  (any other refusal). Save `owm-full` again, then `ccred` with its values and `ctoken`.
- **Observe:** the app expects `result.accessToken`, `tokenType` "bearer" and `expiresIn` 7200 (it
  renews the token by running `get_tokens` again, 60 s before it expires, and never uses the refresh
  token). Documented codes: -90106 wrong Client ID or Client Secret, -52602 / -90112 expired or
  deleted (-52602 is the only one seen so far), -90113 disabled.
- **Record:** the answer's keys, `tokenType` and `expiresIn`; the HTTP status and `errorCode` of the
  wrong secret, the wrong Client ID, each region, the deleted and the disabled credential; the app's
  lines. ☐ pass ☐ fail

### C.5 The organization list (§11 item 3)

- *Probe:*

  ```sh
  orgs | jq -c '{errorCode, msg, totalRows: .result.totalRows, currentPage: .result.currentPage,
    currentSize: .result.currentSize, rows: (.result.data | length?)}'
  orgs | jq -c '.result.data[]? | {orgName, online, deviceType, orgVersion, serverHost,
    omadacIdOk: ((.omadacId // "") | tostring | test("^[A-Za-z0-9_-]{1,64}$")),
    deviceIdLength: ((.deviceId // "") | tostring | length)}'
  orgs 2 1 | jq -c '{errorCode, totalRows: .result.totalRows, currentPage: .result.currentPage,
    rows: (.result.data | length?)}'
  corg "$CORG"
  ```

- **Observe:** `errorCode` 0 with `pageSize=100`; `totalRows` equals `rows`, and the app showed as
  many controllers in C.2; page 2 of one row each has `currentPage` 2 and the same `totalRows`. For
  each organization: `deviceType` (the app accepts any `SMB.OMADA.*CONTROLLER`, in any case; what
  do the OC200s report?), the `orgVersion` form (the app accepts a dotted version such as
  `6.3.0.45`), `serverHost` (one of the three hosts; normally your region's), `online`, and
  `omadacIdOk` true. If Part 0's kit is open in another window, its `OMADAC` equals "Omada red
  antigua (Proxmox)"'s `omadacId` (C.2's **This network** / **Esta red** mark says the same).
  `corg` prints `selected …`.
- **Optional, a stopped controller:** stop the local software controller (its VM or service: the
  access points keep broadcasting, but nothing can be managed meanwhile) and wait until the portal
  shows it offline. `orgs | jq -c '.result.data[]? | {orgName, online}'`; in the app,
  **Test cloud access** / **Probar el acceso a la nube** lists it with
  **Offline: the controller is not online in the TP-Link cloud.** /
  **Sin conexión: el controlador no está en línea en la nube de TP-Link.**, and **Connect** /
  **Conectar** fails without offering **Connect through TP-Link cloud** /
  **Conectar a través de la nube de TP-Link** (its cloud entry is offline). Start it again and wait
  until it is online.
- **Record:** the counts, each organization's fields (record sheet), page 2, and the optional
  offline observation. ☐ pass ☐ fail

### C.6 TLS certificates of the cloud (§11 item 7)

- *Probe:*

  ```sh
  for h in "$CB" "$SH"; do
    printf '%s: ' "$h"
    ccurl -o /dev/null -w 'verify result %{ssl_verify_result}, HTTP %{http_code}\n' "$h/"
    openssl s_client -connect "${h#https://}:443" -servername "${h#https://}" </dev/null 2>/dev/null |
      openssl x509 -noout -subject -issuer -enddate
  done
  ```

- **Observe:** `verify result 0` for both (curl checks the chain against the system's CAs; any HTTP
  status is fine), and a public CA as issuer. In the app, C.2 needed no certificate dialog: the
  cloud session uses Chromium's normal verification, so a working test proves the chain verifies in
  Electron as well.
- **Record:** the verify results, the issuers and the expiry dates. ☐ pass ☐ fail

### C.7 The controller switcher

The switcher reads the cloud controller list when the app starts and after every Settings save
(restart the app, or save Settings, to read it again).

- **Do:** with the local controller connected and `owm-full` saved, look at the top of the sidebar
  (above **Access points** / **Puntos de acceso**) and open the switcher: click it, or Tab to it and
  press Enter.
- **Observe (visibility, the duplicate hidden):** the toggle shows **Controller** / **Controlador**
  and **This network** / **Esta red**. The list starts with **This network** / **Esta red** and the
  controller's host, marked as the current one, then "OC200 Planta 3" and "OC200 Planta 4" by name,
  each with **Cloud** / **Nube** and its version. "Omada red antigua (Proxmox)" is not listed: it is
  this network. The arrow keys, Home and End move between the entries; Escape closes the list and
  puts the focus back on the toggle. At a window width between 800 and 1000 px only the toggle's
  icon shows, with the tooltip **Controller: …** / **Controlador: …**.
- **Observe (disabled entries and their reasons):** a controller that cannot be used is still
  listed and focusable, but choosing it does nothing; its reason is under it, e.g.
  **Offline: the controller is not online in the TP-Link cloud.** /
  **Sin conexión: el controlador no está en línea en la nube de TP-Link.** or
  **Cannot be used: it runs a version older than Omada 6.3.** /
  **No se puede usar: es anterior a Omada 6.3.** On 2026-10-07 all three controllers ran 6.3.0.45:
  if none is disabled, record "none disabled". For the offline reason,
  an OC200 has to be offline (someone at its site may unplug it for a few minutes; then restart the
  app): its entry shows the reason, and the other one stays usable.
- **Do (a switch and back):** choose `CORG`.
- **Observe:** while it connects, the toggle is disabled with the tooltip
  **Wait for the current operation to finish before switching controllers.** /
  **Espera a que termine la operación en curso para cambiar de controlador.**; the views show their
  loading placeholders; nothing of the local controller is left (selection, destination, filters,
  searches, details, **Back to …** / **Volver a …** history). With several sites, **Select site** /
  **Seleccionar sitio** asks for one. Then the header shows `CORG`'s name, its site and version, the
  toggle shows `CORG` with the **Cloud** / **Nube** tag, and the three views load its data.
- **Do:** choose **This network** / **Esta red**: the app connects directly again (the header shows
  the host). Choose `CORG` again, quit the app and start it again.
- **Observe:** the app starts on `CORG` without asking (its site remembered, no site dialog).
- **Record:** the time each switch took, the site question, anything left over from the other
  controller, the restart. ☐ pass ☐ fail

### C.8 Data through the tunnel (§11 items 8 and 12)

- **Do:** connected to `CORG`, go through **Access points** / **Puntos de acceso** (open two
  **AP details** / **Detalles del AP**), **AP groups** / **Grupos de AP** and **Wi-Fi networks** /
  **Redes Wi-Fi**, and compare with the controller's own web interface (opened from the portal).
- **Observe:** names, status, group and client counts match the web interface. A value the Open API
  does not report reads as unknown, never as a guess: **Unknown status** / **Estado desconocido**,
  **Unknown group** / **Grupo desconocido** (in the details:
  **Unknown: the controller did not report this AP's group** /
  **Desconocido: el controlador no informó del grupo de este AP**), clients
  **Not reported by the controller** / **El controlador no informa de ellos**, and
  **Networks unknown** / **Redes desconocidas** for a group whose networks are not reported.
  Gateways and switches are not listed.
- *Probe:*

  ```sh
  csites | jq -c '{errorCode, totalRows: .result.totalRows, sites: [.result.data[]? |
    {siteId, name, idOk: ((.siteId // "") | tostring | test("^[A-Za-z0-9_-]{1,64}$"))}]}'
  CSITE='…'   # siteId of the site the app connected to
  caps | jq -c '{errorCode, totalRows: .result.totalRows, rows: (.result.data | length?),
    fields: ([.result.data[]? | keys[]] | unique), deviceTypes: ([.result.data[]?.deviceType] | unique),
    statusCategories: ([.result.data[]?.statusCategory] | unique), macSample: .result.data[0].mac?,
    withGroupId: ([.result.data[]? | select(.apGroupId != null)] | length),
    withGroupName: ([.result.data[]? | select(.apGroupName != null)] | length),
    withClientNum: ([.result.data[]? | select(.clientNum != null)] | length)}'
  caps 2 1 | jq -c '{errorCode, totalRows: .result.totalRows, currentPage: .result.currentPage,
    rows: (.result.data | length?)}'
  cgroups | jq -c '{errorCode, totalRows: .result.totalRows, groups: [.result.data[]? |
    {id, name, primary, apNum, ssids: (.ssidNameList | if type == "array" then length else type end)}]}'
  ```

- **Observe:** every `idOk` is true (the app's site-id guard); the access-point listing's
  `totalRows` equals `rows`; the field names (the app reads `mac`, `name`, `apGroupId`,
  `apGroupName`, `clientNum`, `statusCategory` and `deviceType`); the MAC form (the app accepts
  `AA-BB-CC-DD-EE-FF` and `aa:bb:cc:dd:ee:ff`); which `deviceType` values the site has (gateway and
  switch rows are left out); page 2 of one row each works when the site has two devices or more;
  every group reports `ssidNameList` as a list.
- **Record:** the site ids, the field names, the device types, the counts and anything the app shows
  as unknown. ☐ pass ☐ fail

### C.9 Management through the tunnel (§11 item 6)

On a cloud controller, management access comes from the cloud credential, not from
**Management access (optional)** / **Acceso de gestión (opcional)**: it is on when the cloud token
works and the site is listed (the comparison with the controller's internal AP-group list cannot
run through the cloud).

- **Do:** connected to `CORG` with `owm-full`, open **Settings** / **Ajustes** and click
  **Test management access** / **Probar el acceso de gestión**.
- **Observe:** **Management access works: every check passed.** /
  **El acceso de gestión funciona: se superaron todas las comprobaciones.**; no read-only banner;
  **AP groups** / **Grupos de AP** offers **New group** / **Nuevo grupo**; **Wi-Fi networks** /
  **Redes Wi-Fi** lists the networks with their state, security, bands and scope (the `/openapi/v2/`
  catalog and the v1 details and bindings through the tunnel). *Probe:*
  `cnets | jq -c '{errorCode, msg, totalRows: .result.totalRows?, rows: (.result.data | length?)}'`
- **Do (writes on disposable resources only, as Steps 2–4 do them locally):**
  `printf '%s' "$T" | pbcopy`, then
  1. **New group** / **Nuevo grupo** `$T` → **Create group** / **Crear grupo**; the same for
     `${T}_B`;
  2. **Rename** / **Cambiar nombre** `$T` to `${T}_R`, then back to `$T`;
  3. **New network** / **Nueva red** `$T`: WPA-Personal, a throwaway password, bound only to `$T`,
     **Enable after creating** / **Activar después de crearla** unticked → **Create network** /
     **Crear red**;
  4. **Edit** / **Editar**: rename it to `${T}_E` → **Review changes** / **Revisar los cambios** →
     **Save changes** / **Guardar cambios** (it asks for the password again);
  5. **Change password** / **Cambiar contraseña**;
  6. **Enable** / **Activar**, then **Disable** / **Desactivar** (its only group is empty, so
     nothing broadcasts it);
  7. **Change AP groups** / **Cambiar grupos de AP**: tick `${T}_B` → **Review the change** /
     **Revisar el cambio** → **Save AP groups** / **Guardar grupos de AP**; then untick it again the
     same way (both groups are empty).

  Keep `$T`, `${T}_B` and `${T}_E` for C.10 and C.11.
- **Observe:** each step's toast, as in Steps 2–4, and the same result in the web interface. A
  refusal's line carries the codes and, on a cloud controller, TP-Link's message: record it.
- **Record:** the test line, each write's result, any call that fails through the tunnel (v1 or v2).
  ☐ pass ☐ fail

### C.10 Moves through the tunnel (§11 items 9 and 11; optional)

Only with a `CAP_NAME` (C.0 rule 2). A move through the cloud is the Open API call
`PATCH …/aps/{mac}/wlan-group`; the app counts it as moved only when a re-read of the access-point
list shows the access point in the destination group (up to 3 reads, 1 s apart).

- **Do:** in **Access points** / **Puntos de acceso**, note `CAP_NAME`'s group (`CAP_GROUP`) and its
  MAC (`CAP_MAC`, in its details). Tick it alone, pick `$T` in **Move selected APs** /
  **Mover los AP seleccionados**, click **Move AP** / **Mover AP** and confirm in
  **Review the move** / **Revisar el movimiento**. While it runs, the switcher is disabled
  (**Wait for the current operation to finish before switching controllers.** /
  **Espera a que termine la operación en curso para cambiar de controlador.**).
- **Observe:** **Move results** / **Resultado del movimiento** shows **Moved** / **Movido**, or
  **Failed** / **Error** with a reason that starts with `moveRequestFailed`, `moveNotConfirmed` or
  `moveUnverified`: record it verbatim. Note how long the move took. *Probe:*
  `caps | jq -c --arg mac "$CAP_MAC" '.result.data[]? | select((.mac // "" | ascii_upcase | gsub(":"; "-")) == ($mac | ascii_upcase | gsub(":"; "-"))) | {name, mac, apGroupId, apGroupName}'`
  shows `$T`.
- **Do (always):** move `CAP_NAME` back to `CAP_GROUP` the same way (the web interface if the app
  cannot, C.R).
- **Optional write probe, the current group:** the app never sends a move into the access point's
  current group (it skips access points already there). `csamegroup "$CAP_MAC"` reads its current
  group id fresh and sends exactly that id, so nothing can change; record `errorCode` and `msg` (the
  documented answer is "cannot be the current wlan group").
- **Optional, a bulk move:** only if the site has a second access point you may silence for a
  minute: move both into `$T` and back, and note whether one fails with the rate-limit reason (each
  move is one request plus one to three paged reads, all through the credential's throttle).
- **Record:** the result, the time, `CAP_NAME` back in `CAP_GROUP`, the probe's answer.
  ☐ pass ☐ fail

### C.11 A view-only credential, and an organization outside it (§11 items 6 and 10)

- *Probe (an organization `owm-view` does not include):*

  ```sh
  corg 'OC200 Planta 3'        # not CORG; still owm-full's token: keeps that controller's tunnel ids
  ccred                        # owm-view's values
  ctoken
  orgs | jq -c '{errorCode, names: [.result.data[]?.orgName]}'
  tcall "v1/$OMID/sites?page=1&pageSize=1" -o "$A" -w 'HTTP %{http_code}\n'; jq -c '{errorCode, msg}' "$A"
  ```

- **Observe:** `owm-view` lists `CORG` only; the call to "OC200 Planta 3" with its token is refused
  (documented: -44121, "no permission to access this organization").
- **Do (app):** save `owm-view` in the TP-Link cloud section (the app reconnects to `CORG` with it)
  and try, on the disposable resources only: **Rename** / **Cambiar nombre** `$T` to `${T}_V`;
  **New group** / **Nuevo grupo** `${T}_V2`; **Enable** / **Activar** on `${T}_E` (bound to the
  empty `$T`); and, if C.10 ran, the move of `CAP_NAME` into `$T`.
- **Observe:** reads work; each write is refused with TP-Link's code and message in the error line.
  Anything `owm-view` is unexpectedly allowed happened to a disposable resource: undo it with
  `owm-full` (rename back, delete `${T}_V2`, disable the network, move `CAP_NAME` back at once).
- **Do:** save `owm-full` again in Settings; in the terminal `ccred` (its values), `ctoken`,
  `corg "$CORG"`.
- **Do (the test resources are no longer needed):** with `owm-full`, delete the network `${T}_E`
  (**Delete** / **Eliminar** → **Delete network** / **Eliminar red**), then the groups `$T`,
  `${T}_B` and, if it exists, `${T}_V2` (**Delete group** / **Eliminar grupo**); the probe of C.R
  step 2 prints `[]` twice.
- **Record:** the organizations `owm-view` lists, the probe's answer, each write's refusal (code and
  message), the deletions. ☐ pass ☐ fail

### C.12 Token errors on the list and through the tunnel (§11 item 4)

- *Probe:*

  ```sh
  COLD="$CTOKEN"; CTOKEN='AT-not-a-valid-token'
  ccall "v1/organizations?page=1&pageSize=1" -o "$A" -w 'list: HTTP %{http_code}\n'; jq -c '{errorCode, msg}' "$A"
  tcall "v1/$OMID/sites?page=1&pageSize=1" -o "$A" -w 'tunnel: HTTP %{http_code}\n'; jq -c '{errorCode, msg}' "$A"
  CTOKEN="$COLD"
  ```

- **Optional, an expired token:** `COLD="$CTOKEN"`, wait `expiresIn` seconds (C.4) plus a minute,
  run the two calls with `CTOKEN="$COLD"` instead of the invalid one, then `ctoken`.
- **Observe:** the list answered HTTP 401 with -44116 on 2026-10-07; the tunnel's answer is new. The
  app treats HTTP 401, -44112, -44113 and -44116 as a rejected token: it gets a new one once and
  retries, and only a second rejection shows
  **TP-Link rejected the access token even after renewing it. Try again later.** /
  **TP-Link rechazó el token de acceso incluso después de renovarlo. Vuelve a intentarlo más tarde.**
- **Record:** the HTTP status and `errorCode` of each call (and of the optional expired token).
  ☐ pass ☐ fail

### C.13 The rate limit (§11 items 5 and 11; -7132 by rapid switching)

TP-Link allows 10 requests per second per credential. The app starts at most 5 per second per
credential (its token requests, the controller list and every tunnel call share the budget); a
-7132 or HTTP 429 holds all of them back (1 s, then 2, 4 and 8 s while the answers repeat), and a
request is retried at most 3 times before the rate-limit line shows.

- *Probe:* `cburst 15`, then `cburst 15 tunnel` (the shell prints a line per background job, then
  one `HTTP` line and one `errorCode` line per request).
- **Optional, token requests:** `cburst 8`, then `cmixburst` (8 reads and 4 token requests at
  once). A -7132 or 429 with `cmixburst` but not with `cburst 8` means token requests count. It asks
  for 4 tokens at once: TP-Link may answer -90114 (too many authentications) and hold the credential
  back for a while.
- **Do (app, rapid switching):** switch between "OC200 Planta 3" and `CORG` ten times, each as soon
  as the previous one has loaded; then once more while `cburst 15` runs in the terminal.
- **Observe:** each switch loads, maybe slowly, or its error shows
  **TP-Link is receiving too many requests for this credential (rate limit). Wait a moment and try again.** /
  **TP-Link está recibiendo demasiadas solicitudes con esta credencial (límite de frecuencia). Espera un momento y vuelve a intentarlo.**
  with the codes in parentheses and **Retry** / **Reintentar**, which works after a few seconds; a
  view never shows part of a list.
- **Record:** which bursts got -7132 or HTTP 429 (list, tunnel, tokens), the switch that showed the
  rate-limit line, if any, and the slowest switch. ☐ pass ☐ fail

### C.14 Connect through TP-Link cloud (the local controller out of reach)

- **Do:** choose **This network** / **Esta red**, then **Disconnect** / **Desconectar**. Take the
  computer off the local network but keep it online, e.g. on a phone's hotspot (Ethernet unplugged),
  while the local controller stays on its network and online in the TP-Link cloud. Click
  **Connect** / **Conectar**.
- **Observe:** when the connection fails (possibly only at its timeout), the error offers
  **Retry** / **Reintentar**,
  **Connect through TP-Link cloud** / **Conectar a través de la nube de TP-Link** and
  **Settings** / **Ajustes** (the app reads the cloud list once to decide). Click
  **Connect through TP-Link cloud** / **Conectar a través de la nube de TP-Link**: the same
  controller connects through the cloud; the header shows its cloud name, "Omada red antigua
  (Proxmox)", and the switcher's **This network** / **Esta red** carries the **Cloud** / **Nube**
  tag. The views show the same groups and access points as the direct connection.
- **Do:** back on the local network, choose **This network** / **Esta red** in the switcher.
- **Observe:** it connects directly (the header shows the host, no **Cloud** / **Nube** tag).
- **Record:** the time until the error, the offer, the data through the cloud, the way back.
  ☐ pass ☐ fail

### C.15 Remove cloud access while a cloud controller is in use (with a local controller)

- **Do:** choose `CORG`. **Settings** / **Ajustes** → **Remove cloud access** /
  **Quitar el acceso a la nube** → **Remove** / **Quitar**; Settings shows
  **Cloud access will be removed when you save.** / **El acceso a la nube se quitará al guardar.**
  (**Keep cloud access** / **Mantener el acceso a la nube** would undo it). Click **Save** /
  **Guardar**.
- **Observe:** the app reconnects to the local controller directly (the header shows its host); the
  switcher is gone from the sidebar; the TP-Link cloud fields are empty and the certificate section
  has no cloud note. Quit and start the app: it starts on the local controller.
- **Record:** the result. ☐ pass ☐ fail

### C.16 Cloud only (no local controller)

This step sets the configuration aside, starts the app with none, and puts it back. A guard in its
own terminal window does both, and puts the configuration back on every way out of that window, not
only when you ask it to.

- **Do:** quit the app. Open a new terminal window (in zsh, run `setopt interactivecomments` first)
  and paste the guard. It refuses to start while `config.json` is missing or a backup from an
  earlier run is left (then see C.R item 5). Otherwise it copies `config.json` to a backup with a
  new, unique name next to it (`config.json.owm-live-backup.` and six random characters, mode
  `0600`, never over an earlier file), checks the copy with `cmp`, and only then removes
  `config.json`. The backup stays in the app's own private directory, and the secrets it holds are
  encrypted with the macOS Keychain key, which does not change.

  ```sh
  (
    d="$HOME/.omada-wlan-manager"; cfg="$d/config.json"; ok=0
    # Refuse to start without a configuration, or while a backup from an earlier run is left (C.R item 5)
    [ -f "$cfg" ] || { printf 'STOP: %s is missing: see C.R item 5\n' "$cfg"; exit 1; }
    for f in "$d"/config.json*; do
      case "$f" in "$d"/config.json.owm-live-backup.*) printf 'STOP: %s is left: see C.R item 5\n' "$f"; exit 1;; esac
    done
    # A backup under a new unique name (mode 0600), verified before anything is removed
    bak="$(mktemp "$d/config.json.owm-live-backup.XXXXXX")" || exit 1
    if ! { cp -fp "$cfg" "$bak" && cmp -s "$cfg" "$bak"; }; then
      rm -f "$bak"; printf 'STOP: the backup failed; nothing was changed\n'; exit 1
    fi
    # Puts the backup back and verifies it, ignoring Ctrl-C and hang-ups meanwhile. The backup
    # goes only after a verified restore you asked for; an interrupted run keeps it (C.R item 5)
    owmrestore() {
      trap '' HUP INT TERM
      if cp -fp "$bak" "$cfg" && cmp -s "$bak" "$cfg"; then
        if [ "$ok" = 1 ]; then
          rm -f "$bak"; printf 'Configuration restored and verified.\n'
        else
          printf 'INTERRUPTED: configuration restored and verified; backup kept: %s\n' "$bak"
          printf 'Quit the app without changing anything, then see C.R item 5.\n'
        fi
        return 0
      fi
      printf 'STOP: the restore failed; the configuration is in %s (C.R item 5)\n' "$bak"
      return 1
    }
    trap owmrestore EXIT
    trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
    rm -f "$cfg" || exit 1
    printf 'Configuration set aside; backup: %s\n' "$bak"
    ans=
    until [ "$ans" = restore ]; do
      printf 'Keep this window open. After the last step, quit the app and type  restore  here: '
      read -r ans || exit 1
    done
    ok=1
    owmrestore && trap - EXIT HUP INT TERM
  )
  ```

  It prints `Configuration set aside; backup: …` and waits for `restore`; anything else, an empty
  line or `exit` included, only asks again. Keep the window open until the end of the step. If the
  window is closed, Ctrl-C is pressed in it, or its shell gets a hang-up or a `kill`, the guard puts
  the configuration back at once, checks it with `cmp`, keeps the backup and prints
  `INTERRUPTED: configuration restored and verified; backup kept: …`. Then quit the app without
  changing anything (it still holds the cloud-only configuration, and its next save would write
  that over the restored file) and follow C.R item 5.

- **Do:** start the app: Settings opens, as on a first launch. Leave **Controller URL** /
  **URL del controlador**, **Username** / **Usuario** and **Password** / **Contraseña** empty, fill
  in the TP-Link cloud section with `owm-full` and click **Save** / **Guardar**. (A Client ID under
  **Management access (optional)** / **Acceso de gestión (opcional)** is refused here with
  **Management access belongs to a controller on this network: enter its URL, username and password first, or leave the Client ID and Client Secret empty.** /
  **El acceso de gestión pertenece a un controlador de esta red: introduce primero su URL, usuario y contraseña, o deja vacíos el Client ID y el Client Secret.**)
- **Observe:** the views show **Choose a TP-Link cloud controller to get started** /
  **Elige un controlador de la nube de TP-Link para empezar** with **Choose controller** /
  **Elegir controlador**, which opens the switcher; the toggle shows **None chosen** /
  **Ninguno elegido**; the list has no **This network** / **Esta red** and lists all three
  controllers, "Omada red antigua (Proxmox)" included (without a local controller it is one more
  cloud controller).
- **Do:** choose `CORG`; once it has loaded, quit and start the app.
- **Observe:** it starts on `CORG` without asking.
- **Do:** **Settings** / **Ajustes** → **Remove cloud access** / **Quitar el acceso a la nube** →
  **Remove** / **Quitar** → **Save** / **Guardar**, while connected to `CORG`.
- **Observe:** the app lands in the first-launch state: no data, **Connect** / **Conectar**
  disabled, no switcher, and the views show **Set up the connection in Settings to get started** /
  **Configura la conexión en Ajustes para empezar** with **Configure connection** /
  **Configurar la conexión**.
- **Do (always):** quit the app (its next save would otherwise write over the restored file), then
  type `restore` in the guard's window and press Enter. The guard puts the configuration back,
  checks it with `cmp`, and only then deletes the backup and prints
  `Configuration restored and verified.` (A `STOP: the restore failed; …` line instead: C.R item 5.)
  Close the window and start the app: it connects to the local controller as before.
- **Record:** each observation. ☐ pass ☐ fail

### C.R Clean-up and close (always)

1. **`CAP_NAME` back in `CAP_GROUP`:** the app (C.10) or the controller's web interface.
2. **Test resources on `CORG`** (C.11 deleted them): delete anything `__OWM_TEST_` that is left,
   networks before groups, in the controller's web interface or in the app with `owm-full` saved
   (C.15 removed it from Settings). *Probe (with `owm-full`'s token, `corg "$CORG"` and `CSITE`):*

   ```sh
   cgroups | jq -c '[.result.data[]? | select((.name // "") | ascii_downcase | startswith("__owm_test_")) | {id, name}]'
   cnets | jq -c '[.result.data[]? | select((.name // "") | ascii_downcase | startswith("__owm_test_")) | {id, name}]'
   ```

   Both print `[]`.
3. **Credentials:** *web UI:* delete `owm-view`, and `owm-full` unless the app keeps cloud access
   (then save it in Settings once more); `owm-throwaway` is gone since C.4.
4. **Close the cloud kit:** `ckitclose`. It deletes the private directory, unsets the secrets
   (`CCSECRET`, `CTOKEN`, `COLD`, `CCID`) and every helper; then close the terminal window. If the
   window was closed first, delete the private directory printed in C.3 (`owm-secrets.…`) by hand.
5. **The configuration, if C.16 did not end with `Configuration restored and verified.`:** quit the
   app and list its directory:

   ```sh
   ls -l "$HOME/.omada-wlan-manager/"
   ```

   No `config.json.owm-live-backup.…` file: nothing to do. Otherwise that file is the configuration
   C.16 set aside (the guard refuses to start while one is left, so there is at most one). The
   guard keeps it when it was interrupted, after putting the configuration back; and it is all that
   is left when the guard's shell ended without running its trap (a forced kill, a crash, or a
   terminal that kills its processes outright when the window closes): `config.json` is then
   missing or is the cloud-only one. Either way, put it back, with the six characters from the
   list in place of `XXXXXX`:

   ```sh
   mv -f "$HOME/.omada-wlan-manager/config.json.owm-live-backup.XXXXXX" "$HOME/.omada-wlan-manager/config.json"
   ```

   Start the app: it connects to the local controller as before.

- **Record:** the result. ☐ pass ☐ fail

## Feedback (optional)

Design questions recorded during phases 13–20 that only you can answer:

- The default window (900×650) opens with the icon-only sidebar. Open it about 1100 px wide instead?
  ☐ yes ☐ no
- A fully successful move still ends on **Move results** / **Resultado del movimiento**, which needs
  one **Close** / **Cerrar**. Close it automatically when every access point moved? ☐ yes ☐ no
- Changing the Controller URL in Settings has no confirmation step (it drops the stored credentials
  and closes the connection). Add one? ☐ yes ☐ no

## Cross-reference

Every row of spec §5 and every "unverified live" item recorded in phases 12–20a, with how far a run
of this checklist covers it; for Part C, every item of `docs/omada-cloud-openapi.md` §11 (rows
`C11-…`, "cloud contract") and the live steps recorded in inbox phases I-1a to I-1c2b (rows
`I-1…`). Sources: `todo.md` 4.5–4.13 and §5 "Done" entries, `docs/progress-archive/phase-*.md`,
and the leftovers under "Open risks" in `PROGRESS.md`. Coverage:

- *Covered (steps)*: the steps observe the behavior on this controller.
- *Partly covered (steps)*: what the steps observe, and what they do not.
- *Deferred*: not provoked on a production controller, with the reason.

An item that depends on an optional step, or on something the site or the account may not have (an
"All access points" network, a disconnected access point, a per-AP override, a cloud controller older
than 6.3), is at most partly covered.

| ID | Unverified behavior | Recorded in | Coverage | Result |
|---|---|---|---|---|
| §5-1 | Open API token endpoint, body and header (not in the self-hosted spec) | spec §5 | Covered (0.3, 5.1) | |
| §5-2 | Internal site id equals the Open API `siteId` | spec §5 | Covered (0.3, 5.2) | |
| §5-3 | Internal group id equals the Open API `apGroupId` | spec §5 | Covered (0.3, 1.1, 5.3) | |
| §5-4 | Catalog enable field: `ssidEnable` or a boolean `description` | spec §5 | Covered (3.2, 4.5, 5.4, 5.9) | |
| §5-5 | Whether the SSID detail returns the passphrase in clear | spec §5 | Covered (3.2, 4.4, 5.5, 5.9) | |
| §5-6 | How the binding PATCH enters and leaves "All devices" | spec §5 | Partly covered (5.6b): how an existing "All access points" network is reported, if the site has one. Deferred: entering or leaving that scope through the binding PATCH (5.6c: it would bind a test network to every production group; isolated test site only) | |
| §5-7 | What the controller does with the access points of a deleted group | spec §5 | Deferred: not provoked on production (it could strand EAP Carpio). 6.2 observes only the app's own refusal to delete a group that has access points | |
| 12-1 | `setting/wlans` on pre-6.3 controllers (the fallback to `setting/ssids` covers it) | PROGRESS Open risks (phase 12) | Deferred: needs a pre-6.3 controller | |
| 13a-1 | `clientNum` on the internal device list | phase-13a.md; PROGRESS (13a) | Covered (1.4); 6.4 (optional) adds a known client | |
| 14a-1 | Element fields of `ssidOverrides[]` in `GET eaps/{mac}` | todo 4.7 Done (14a); PROGRESS (14a) | Partly covered (1.3): the field names show only if EAP Carpio has at least one per-AP override | |
| 15a-1 | Token endpoint, body and `AccessToken=` header | todo 4.8 Done (15a); phase-15a.md | Covered (5.1) | |
| 15a-2 | Token answer shape; `expiresIn` (300 s assumed when absent) | todo 4.8 Done (15a); phase-15a.md | Covered (5.1) | |
| 15a-3 | Token rejected = HTTP 401 or errorCode -44112 / -44113 | todo 4.8 Done (15a); phase-15a.md | Partly covered (5.1): an invalid token and one without `AccessToken=`. An expired token only with 5.1's optional wait | |
| 15a-4 | Bad Client ID or Secret = errorCode -44106 (or HTTP 401 / 403) | todo 4.8 Done (15a); phase-15a.md | Covered (5.1) | |
| 15a-5 | Client ID format: 1–128 of `[A-Za-z0-9._-]` | todo 4.8 Done (15a); phase-15a.md | Partly covered (0.3, 5.1): only your own Client ID meets the rule; other Client IDs the controller may issue are not seen | |
| 15b-1 | Internal and Open API site ids are the same values | todo 4.8 Done (15b); phase-15b.md | Covered (5.2) | |
| 15b-2 | Internal and Open API AP-group ids are the same values | todo 4.8 Done (15b); phase-15b.md | Covered (1.1, 5.3) | |
| 16a-1 | POST without `apMacs` accepted; `result.id` equals the internal `setting/wlans` id | todo 4.9 Done (16a); phase-16a.md | Covered (2.1, 2.6) | |
| 16a-2 | PATCH with only `name` leaves the group's access points untouched | todo 4.9 Done (16a); phase-16a.md | Covered (6.3) | |
| 16a-3 | ErrorCodes -33200 / -33201 / -33203 | todo 4.9 Done (16a); phase-16a.md | Partly covered (2.5): -33200. Deferred: -33201 (needs the controller's group limit filled) and -33203 (it would put the default group at risk) | |
| 16a-4 | The controller's own duplicate-name rule, and whether case matters | todo 4.9 Done (16a); phase-16a.md | Covered (2.5) | |
| 16a-5 | `apNum` counts every access point; `ssidNameList` every bound network, disabled and "All access points" ones too | todo 4.9 Done (16a); phase-16a.md | Partly covered (3.2, 5.9, 6.1): disabled networks and connected access points. "All access points" networks only if the site has one (5.6b); a disconnected access point only if one exists (5.9) | |
| 16a-6 | `remainingBinding` keys (an MLO key?) and the `maxSsids*` fields | todo 4.9 Done (16a); phase-16a.md | Covered (2.2, 5.8) | |
| 16a-7 | How the 128-character name limit is counted; which characters are accepted | todo 4.9 Done (16a); phase-16a.md | Covered (2.4) | |
| 16a-8 | Groups whose id is not 24 hex digits (listed, not writable) | PROGRESS Open risks (16a) | Covered (1.2): lists any such group the site has | |
| 16b-1 | A new group appears in the internal `setting/wlans` list right after the reload | phase-16b.md; PROGRESS (16b) | Covered (2.1) | |
| 16b-2 | Whether `remainingBinding` has an MLO key | phase-16b.md; PROGRESS (16b) | Covered (2.2, 5.8) | |
| 16b-3 | After a write, main does not re-run the `apGroupsMismatch` id comparison | phase-16b.md; PROGRESS (16b) | Covered (2.1, 2.3, 8): the id sets still match after a create and after the deletes | |
| 17a-1 | Which catalog field carries the enable state | todo 4.10 Done (17a); phase-17a.md | Covered (5.4, 5.9) | |
| 17a-2 | The catalog's undocumented `chooseDevices` means what the detail's does | todo 4.10 Done (17a); phase-17a.md | Covered (3.2, 5.9) | |
| 17a-3 | The detail's `pskSetting.securityKey`: in clear, masked or absent | todo 4.10 Done (17a); phase-17a.md | Covered (3.2, 4.4, 5.5) | |
| 17a-4 | What the bindings call answers for an "All access points" network (an error fails the whole read) | todo 4.10 Done (17a); phase-17a.md; PROGRESS (17a, 17b) | Partly covered (0.4, 5.6b, 5.9): only if the site has such a network; the test network is never put on all access points on production | |
| 17a-5 | The detail's `apGroupIds` and the bindings agree; bound ids equal the internal `wlanId`s | todo 4.10 Done (17a); phase-17a.md | Covered (5.3, 5.9) | |
| 17a-6 | `band` uses only the bits 1 / 2 / 4 | todo 4.10 Done (17a); phase-17a.md | Covered (5.9), for this site's networks | |
| 17a-7 | `id` and `ssidId` are equal | todo 4.10 Done (17a); phase-17a.md | Covered (3.2, 5.9) | |
| 17a-8 | Only the security codes 0 and 2–5 occur | todo 4.10 Done (17a); phase-17a.md | Covered (5.9), for this site's networks | |
| 17a-9 | The 128-network cap is enough; time of the sequential read | todo 4.10 Done (17a); phase-17a.md | Covered (5.10) | |
| 17a-10 | Whether the controller caps the page size | phase-17a.md | Partly covered (5.10): a cap shows only if a list has more entries than the cap | |
| 17a-11 | Paging the lists completely (a short or repeating page counts as truncated) | PROGRESS Open risks (17a) | Partly covered (0.3, 0.4, 5.10): on a site whose lists fit one page, a walk over several pages is not exercised | |
| 18a-1 | Create body: `deviceType`, `pmfMode`, `hidePwd` required as documented | todo 4.11 Done (18a) | Covered (3.1) | |
| 18a-2 | `ssidEnable: false` and `apGroupIds` + `chooseDevices: 1` honored at creation | todo 4.11 Done (18a) | Covered (3.1, 3.2) | |
| 18a-3 | PMF "Disabled" suits open networks | todo 4.11 Done (18a) | Covered (4.3) | |
| 18a-4 | An open 6 GHz network without OWE; may a create carry `oweEnable` | todo 4.11 Done (18a); PROGRESS (18a) | Partly covered (4.3 (b)): an edit to Open with 6 GHz. Not observed: a create with `oweEnable` (the app refuses an open 6 GHz network at creation, so it never sends one) | |
| 18a-5 | `result.id` is the new network's id; how often it is missing | todo 4.11 Done (18a, 18b); phase-18b.md | Partly covered (3.3): one create-and-enable shows whether the id came back; how often it is missing needs many creates | |
| 18a-6 | Is `basic-config` a full replace; does it keep bindings, enable state, rate limits, schedules and the other settings | todo 4.11 Done (18a) | Partly covered (4.1): the whole detail is compared, but the test network's rate limits and schedules are at their defaults, so a reset to the defaults would not show | |
| 18a-7 | Key in clear, masked or absent; would a save without `securityKey` keep the key | todo 4.11 Done (18a) | Partly covered (4.4, 5.5): the key's state. Deferred: a save without `securityKey` (the app always sends a typed key) | |
| 18a-8 | Defaults of an Open → WPA-Personal switch; is WPA2-only refused on 6 GHz | todo 4.11 Done (18a) | Partly covered (4.3 (c)): the switch. Not observed: whether the API refuses WPA2-only on 6 GHz (the app never sends it); 4.2 (c) notes only what the web interface offers | |
| 18a-9 | ErrorCodes -33217 / -33219 / -33231 / -33238 / -33240; duplicate names (case, across AP groups) | todo 4.11 Done (18a) | Partly covered (3.4): the duplicate-name codes (-33219 or -33231) and the case rule. Deferred: -33217, -33238 and -33240 (the app refuses those cases before sending) | |
| 18a-10 | The `enable` call: immediate, idempotent, touches nothing else | todo 4.11 Done (18a) | Covered (4.5) | |
| 18a-11 | DELETE of a network still bound to groups; groups' `ssidNameList` and capacity update at once | todo 4.11 Done (18a) | Covered (7.2, 8) for a network bound to one empty group; deleting an "All access points" network is not provoked | |
| 18a-12 | The controller's password rule: leading / trailing spaces, 63 characters | todo 4.11 Done (18a) | Partly covered (4.4): whether the controller accepts both. Whether it keeps the spaces shows only if the detail returns the key in clear, or by joining in 6.4 (optional) | |
| 18a-13 | An absent optional `basic-config` field: unchanged or reset | todo 4.11 Done (18a) | Partly covered (4.1): as 18a-6, a reset to a default value would not show | |
| 18a-14 | The v1 detail returns every `basic-config` field (`greEnable`, `CondBroadcastCtrl`) | todo 4.11 Done (18a) | Covered (4.1, 5.9) | |
| 18a-15 | The derived WPA / PMF / OWE defaults are accepted; does the access point enforce WPA3 + PMF on 6 GHz by itself | todo 4.11 Done (18a) | Partly covered (4.2, 4.3): the controller accepts the derived values. The access point's own enforcement only in 6.4 (optional; needs a 6 GHz radio and a client) | |
| 18a-16 | Does MLO require WPA3 / OWE | todo 4.11 Done (18a) | Partly covered (5.8, optional): only if the web interface offers MLO for the test network | |
| 18a-17 | The full Enhanced IoT Connectivity condition | todo 4.11 Done (18a) | Partly covered (4.2 (c), optional): the web interface's wording only | |
| 18a-18 | PMF Mandatory is lowered to Capable when the bands change | phase-18a.md; PROGRESS (18a) | Covered (4.2 (b)) | |
| 18b-1 | Does the controller lower PMF on a band change, and what does it accept | todo 4.11 Done (18b); phase-18b.md | Covered (4.2 (b)) | |
| 18b-2 | A created network is disabled and the follow-up `enable` uses the reported id | todo 4.11 Done (18b); phase-18b.md | Covered (3.1, 3.3) | |
| 18b-3 | The duplicate-name rule behind `nameTaken` | todo 4.11 Done (18b); phase-18b.md | Covered (3.4) | |
| 18b-4 | Disable / delete disconnect clients only on the network's own scope | todo 4.11 Done (18b); phase-18b.md | Partly covered (6.4, optional): disabling with a client joined. Not observed: deleting a network with clients (7.2 deletes it with no access point) | |
| 18b-5 | Enterprise / PPSK networks enabled, disabled and deleted from the app | todo 4.11 Done (18b); phase-18b.md | Partly covered (5.11, optional): only if an existing profile allows creating the test network | |
| 19a-1 | The binding PATCH replaces the set (not a merge) and keeps `chooseDevices` 1 | todo 4.12 Done (19a); phase-19a.md | Covered (5.6a) | |
| 19a-2 | The binding PATCH for an "All access points" network and with an empty list | todo 4.12 Done (19a) | Deferred: not provoked on production, since either could bind the test network to every production group (5.6c); isolated test site only | |
| 19a-3 | The errorCode for a group without room; per-band capacity check by the controller | todo 4.12 Done (19a); phase-19a.md | Deferred: needs a test group filled to its per-band limit with disposable networks, and the app refuses such a change before sending | |
| 19a-4 | `remainingBinding` drops by one per bound network on each of its bands; MLO slot and key | todo 4.12 Done (19a); phase-19a.md; PROGRESS (19a) | Partly covered (3.2, 5.6a): the per-band drop. The MLO slot only in 5.8 (optional) | |
| 19a-5 | The detail always reports `mloEnable` as a boolean | todo 4.12 Done (19a) | Covered (3.2, 5.9) | |
| 19a-6 | The catalog's `chooseDevices` / `band` always agree with the detail | todo 4.12 Done (19a); phase-19a.md | Covered (5.9) | |
| 19a-7 | The bindings call lists every bound group and, with the detail's `apGroupIds`, reflects a PATCH at once | todo 4.12 Done (19a) | Covered (5.6a) | |
| 19a-8 | Enterprise / PPSK networks accept a binding change | todo 4.12 Done (19a) | Partly covered (5.11, optional): as 18b-5 | |
| 19a-9 | Clients on a removed group's access points are disconnected at once | todo 4.12 Done (19a) | Partly covered (6.4, optional): needs a client near EAP Carpio | |
| 19b-1 | The managed AP-group list's `remainingBinding` drops right after a binding write | todo 4.12 Done (19b) | Covered (5.6a) | |
| 19b-2 | Bindings and detail reflect the PATCH at once, so the toast's scope is the controller's | todo 4.12 Done (19b) | Covered (5.6a) | |
| 19b-3 | A network bound to a group the AP-group list does not list exists live | todo 4.12 Done (19b) | Covered (5.9) | |
| 19b-4 | The re-read before each confirmation is noticeable on a slow controller | todo 4.12 Done (19b) | Covered (5.6a), on this controller | |
| 19b-5 | (UI) Adding groups to an MLO network is refused only at Save | todo 4.12 Done (19b); phase-19b.md; PROGRESS (19b) | Partly covered (5.8, optional): only if the web interface offers MLO for the test network | |
| 19b-6 | (UI) The editor's access-point counts come from internal data, not `apNum` | todo 4.12 Done (19b); phase-19b.md; PROGRESS (19b) | Covered (6.1) | |
| 20a-1 | None recorded: the remaining risks of `docs/security-audit.md` §7 are code-level, not controller behaviors | todo 4.13 Done (20a); phase-20a.md | Not applicable | |
| C11-1 | The portal's Open API page (account flag `showAccountOpenApi`), creating a credential, full versus view-only access | cloud contract §11 (1), §2; spec I-1 "Unknowns" | Covered (C.1, C.11) once TP-Link enables the page for the account; until then no step of Part C can run | |
| C11-2 | `get_tokens` on each region: the answer, `expiresIn`, the codes for a wrong, expired, deleted or disabled credential (only -52602 seen) | cloud contract §11 (2), §4, §9; todo §5 Done (I-1a) | Partly covered (C.4): the answer, a wrong secret and Client ID, each region, a deleted credential, and a disabled one if the portal can disable it. An expired credential needs its validity (30 days at least) to run out | |
| C11-3 | `/v1/organizations`: `pageSize=100`, `totalRows`, the OC200's `deviceType`, the `orgVersion` form, `online` for a controller that is off, the reported `serverHost` | cloud contract §11 (3), §5; todo §5 Done (I-1a) | Covered (C.5); `online` only with C.5's optional stopped controller. A walk over full pages of 100 needs more than 100 organizations (C.5 pages by one row instead) | |
| C11-4 | A bad or expired token on the list and through the tunnel (HTTP 401 and -44116 seen on the list) | cloud contract §11 (4), §6 | Partly covered (C.12): an invalid token on both. An expired one only with the optional wait | |
| C11-5 | The rate limit: do token requests count; -7132 versus HTTP 429; the tunnel's answer | cloud contract §11 (5), §7; todo §5 Done (I-1a) | Partly covered (C.13): what a burst gets on the list and through the tunnel. Token requests only with the optional `cmixburst`, and a one-second window measured from a shell is approximate | |
| C11-6 | The tunnel: every v1 path the app uses, the `/openapi/v2/…` paths, writes with a full and a view-only credential, -44121 for an organization outside the credential | cloud contract §11 (6), §6; spec I-1 "Unknowns" | Covered (C.7–C.11): a connect's reads, the three views, the v2 catalog, every write kind of C.9 (group create / rename / delete, network create / edit / password / enable / disable / binding / delete), the view-only refusals and -44121 (C.11); the move path is C11-9 | |
| C11-7 | The cloud's TLS certificates verify normally in Electron (expected: a public CA) | cloud contract §11 (7), §8 | Covered (C.2, C.6) | |
| C11-8 | `GET …/ap-groups/aps` through the tunnel: the fields, the MAC form, the `deviceType` values, paging and `totalRows` | cloud contract §11 (8), §12; phase-i-1b1.md | Covered (C.8); `deviceType` values only for the device kinds the site has, and full pages of 100 only with more than 100 devices | |
| C11-9 | `PATCH …/aps/{apMac}/wlan-group`: an AP-group id accepted, the MAC form, how soon the re-read shows the move, the code for the current group | cloud contract §11 (9), §12; phase-i-1b1.md | Partly covered (C.10, optional): needs an access point that may be silenced; the current-group code only with its optional write probe | |
| C11-10 | What a view-only credential answers for each write | cloud contract §11 (10), §2 | Partly covered (C.11): a group rename and create, a network's enable and, after C.10, a move. Not observed: the other network writes and the deletes with a view-only credential | |
| C11-11 | A bulk move stays under the rate limit (each move is 1 PATCH plus 1–3 paged reads) | cloud contract §11 (11) | Partly covered (C.10, optional): only with a second access point that may be silenced; otherwise deferred | |
| C11-12 | The tunnel's site ids pass the IPC site-id guard `[A-Za-z0-9_-]{1,64}` | cloud contract §11 (12), §12 | Covered (C.7, C.8) | |
| I-1c2a-1 | The local controller's `/api/info` `omadacId` equals its cloud organization's (how the duplicate is hidden, D6) | todo §5 Done (I-1c2a); phase-i-1c2a.md | Covered (C.2, C.5, C.7) | |
| I-1c2a-2 | A local controller that does not answer at all is told apart from other failures on a real network (`unreachable`) | todo §5 Done (I-1c2a); phase-i-1c2a.md | Covered (C.14; C.5's optional stopped controller adds an offline duplicate, which gets no offer) | |
| I-1c2b-1 | The switcher with a real account: the duplicate hidden, the offline and below-6.3 reasons, a switch and back | todo §5 Done (I-1c2b), "For I-1c3" | Partly covered (C.7): the reasons only for a controller that is offline or older than 6.3 at the time | |
| I-1c2b-2 | "Connect through TP-Link cloud" with the local controller out of reach | todo §5 Done (I-1c2b), "For I-1c3" | Covered (C.14) | |
| I-1c2b-3 | -7132 by rapid switching | todo §5 Done (I-1c2b), "For I-1c3"; phase-i-1c2b.md | Partly covered (C.13): the app's own throttle may keep TP-Link from ever answering -7132 | |
| I-1c2b-4 | Remove cloud access while a cloud controller is in use, with and without a local controller | todo §5 Done (I-1c2b), "For I-1c3" | Covered (C.15, C.16) | |
| I-1c2b-5 | A real restart starts on the stored cloud controller (the smoke plays restarts as window reloads) | phase-i-1c2b.md | Covered (C.7, C.16) | |

### Not verified by this checklist

Even a complete run that passes every step leaves these unobserved:

- Entering or leaving "All access points" through the binding call, and a binding call with an
  empty list (§5-6, 19a-2): isolated test site only.
- What the controller does with the access points of a deleted group (§5-7).
- ErrorCodes -33201 (group limit), -33203 (default group), -33217, -33238 and -33240, and the
  error for a group without room (16a-3, 18a-9, 19a-3).
- `setting/wlans` on controllers older than 6.3 (12-1).
- A save without `securityKey`, a create with `oweEnable`, and WPA2-only on 6 GHz sent through the
  API (18a-7, 18a-4, 18a-8).
- Whether a save resets optional settings that differ from their defaults (18a-6, 18a-13).
- Listings over several pages and a page-size cap, on a site whose lists fit one page (17a-10,
  17a-11); how often a create's answer lacks the new id (18a-5).
- Deleting a network while clients are connected to it (18b-4).
- Depending on the site and on the optional steps you skip: "All access points" networks (16a-5,
  17a-4), a disconnected access point (16a-5), per-AP override fields (14a-1), an expired token
  (15a-3), MLO (18a-16, 19a-4, 19b-5), Enterprise / PPSK (18b-5, 19a-8), live clients (18a-12,
  18a-15, 18b-4, 19a-9) and the Enhanced IoT condition (18a-17).
- Part C: an expired cloud credential and, unless you wait, an expired cloud token (C11-2, C11-4);
  whether token requests count against the rate limit, which a shell measures only roughly (C11-5);
  the switcher reasons other than the ones the account happens to show — older than 6.3, unknown
  version, not a controller, incomplete entry, unsupported cloud server (I-1c2b-1); full pages of 100
  organizations or devices (C11-3, C11-8); the move, its current-group code and a bulk move without an
  access point you may silence (C11-9, C11-11); a view-only credential's answer to the other network
  writes and to the deletes (C11-10); a -7132 the app's own throttle never provokes (I-1c2b-3).

### Leftovers that are not live unknowns

These phase 12–20a leftovers in `PROGRESS.md` describe app design or test-harness choices, so no
controller run settles them; they are listed so that nothing is silently dropped.

- **12:** before connecting, the UI uses the 6.3 "AP groups" wording.
- **13b:** same-named groups cannot be move targets until one is renamed; the review says per-AP
  overrides cannot be shown; a successful move ends on the results dialog (Feedback above).
- **14a:** an access point in a shared-name group shows the network count of the first group with that
  name; the review's wording about overrides (1.3 records their shape); an access point with no group
  makes a network's count "at least M".
- **14b:** the default window width (Feedback above); the banner's pointer to Settings (resolved in 15).
- **15a:** the Linux secret-store check is unit-tested only; two free-text redactor gaps documented in
  `redact.ts`.
- **15b:** the test uses saved credentials only; the old internal session stays installed during a
  reconnect; the TLS probe leans on Electron's certificate cache.
- **16a / 16b:** smoke stack traces for deliberately malformed calls; "Move access points here"
  pre-picks the destination instead of opening a separate picker; one smoke check reaches its state by
  script.
- **17a / 17b:** more rows than `totalRows` counts as complete; hidden / guest / VLAN are not in the
  network DTO; cross-links by name when two networks share it; placement of the networks' stale
  notice; Back entries dropped once management is off.
- **18a / 18b:** MLO compatibility is not checked (5.8 observes MLO); only name, security and bands are
  editable; a click during a background re-read is refused with a toast; the Escape edit-mode stub is
  unused.
- **19b:** the editor is a dialog; a bound group missing from the group list can only be removed (5.9
  checks whether one exists).
- **20a:** the accepted risks in `docs/security-audit.md` §7 (a late test result, URL change without
  confirmation (Feedback above), polite error toasts, detail actions at short heights, inline
  confirmations during a reset; the move channels' session nonce and the `refreshData()` generation
  were closed by inbox phase I-1b2b2).
- **I-1 (TP-Link cloud):** the `config:save` cloud invalidation order has no automated regression
  test (I-1a); a moved access point keeps its old group id in the renderer until the reload, which
  nothing reads (I-1b1); a network that only a group with unreported networks might broadcast is not
  listed, and an access point in a shared-name group reads "Networks unknown" if either group is
  (I-1b2a); a failed write of the stored controller choice is logged and the switch still applies
  (I-1b2b1); `connectionReset` is also reported when the cloud target had nothing connected
  (I-1b2b2, declined); the switcher reads the cloud list only at startup, after a save and before the
  cloud offer, and every unreachable local connect reads it once, so repeated Retry clicks could reach
  -7132 (I-1c2b).
