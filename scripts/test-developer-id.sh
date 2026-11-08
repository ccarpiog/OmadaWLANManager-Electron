#!/usr/bin/env bash
# Selection regressions: duplicate names, legacy first, invalid/missing/wrong-team identities.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/scripts/lib/developer-id.sh"
NEW=D90FF6C655C831F11CC50642E4EF8675905EAF79
OLD=7C016121C0689CB514FB3AC55D74C1199CE7D750
FUTURE=1111111111111111111111111111111111111111
NAME='Developer ID Application: Carlos Carpio García (CXVKS8ZNCD)'
security() { [[ "${SECURITY_FAIL:-0}" == 0 ]] || return 1; printf '%s\n' "$IDENTITIES"; }
IDENTITIES="  1) $OLD \"$NAME\"
  2) $NEW \"$NAME\""
unset DEVELOPER_ID_SHA1
select_developer_id
[[ "$DEVELOPER_ID_HASH" == "$NEW" && "$DEVELOPER_ID_NAME" == "$NAME" ]]
DEVELOPER_ID_SHA1="$(printf '%s' "$NEW" | tr '[:upper:]' '[:lower:]')"
select_developer_id
[[ "$DEVELOPER_ID_HASH" == "$NEW" ]]
# Run failure cases in a subshell so state cannot leak into subsequent checks.
reject() { if (select_developer_id) >/dev/null 2>&1; then echo "Unexpected selection: $1" >&2; exit 1; fi; }
DEVELOPER_ID_SHA1='Developer ID Application'; reject name
DEVELOPER_ID_SHA1=''; reject empty
DEVELOPER_ID_SHA1="$OLD"; reject legacy
unset DEVELOPER_ID_SHA1
IDENTITIES="  1) $OLD \"$NAME\""; reject old-only
IDENTITIES=''; reject missing
IDENTITIES="  1) $NEW \"Apple Distribution: Carlos (CXVKS8ZNCD)\""; reject wrong-type
IDENTITIES="  1) $NEW \"Developer ID Application: Carlos (OTHERTEAM1)\""; reject wrong-team
IDENTITIES="  1) $FUTURE \"$NAME\""; reject no-fallback
DEVELOPER_ID_SHA1="$FUTURE"; select_developer_id
[[ "$DEVELOPER_ID_HASH" == "$FUTURE" ]]
SECURITY_FAIL=1; reject keychain-error
printf 'Developer ID selection tests passed.\n'

# Artifact verification must reject the wrong leaf certificate and extraction failures.
SECURITY_FAIL=0
DEVELOPER_ID_HASH="$NEW"
codesign() { [[ "${CODESIGN_FAIL:-0}" == 0 ]]; }
openssl() { printf 'sha1 Fingerprint=%s\n' "$ARTIFACT_HASH"; }
ARTIFACT_HASH="$NEW"
verify_developer_id_signature 'fixture.app'
ARTIFACT_HASH="$OLD"
if verify_developer_id_signature 'fixture.app' 2>/dev/null; then
  echo 'Accepted the old certificate on the signed artifact.' >&2; exit 1
fi
CODESIGN_FAIL=1
if verify_developer_id_signature 'fixture.app' 2>/dev/null; then
  echo 'Accepted a failed certificate extraction.' >&2; exit 1
fi
printf 'Developer ID artifact verification tests passed.\n'
