#!/usr/bin/env bash
# Shared release policy within this repository. The G2 certificate expires 2027-12-08.
# Renew with an explicit DEVELOPER_ID_SHA1 override, then update the default and backup.

# Select one valid Developer ID Application identity by its complete SHA-1 and team.
# Sets DEVELOPER_ID_HASH, DEVELOPER_ID_NAME and DEVELOPER_ID_TEAM; never falls back.
select_developer_id() {
    local requested identities selected
    DEVELOPER_ID_TEAM="${1:-CXVKS8ZNCD}"
    requested="${DEVELOPER_ID_SHA1-D90FF6C655C831F11CC50642E4EF8675905EAF79}"
    requested="$(printf '%s' "$requested" | tr '[:lower:]' '[:upper:]')"
    if [[ ! "$requested" =~ ^[0-9A-F]{40}$ ]]; then
        echo "DEVELOPER_ID_SHA1 must be a complete 40-character certificate fingerprint." >&2
        return 2
    fi
    if [[ "$requested" == 7C016121C0689CB514FB3AC55D74C1199CE7D750 ]]; then
        echo "The legacy Developer ID certificate is retired for new releases; select its G2 replacement." >&2
        return 2
    fi
    identities="$(security find-identity -v -p codesigning)" || {
        echo "Cannot read valid signing identities from the keychain." >&2
        return 2
    }
    selected="$(printf '%s\n' "$identities" | awk -v hash="$requested" -v team="($DEVELOPER_ID_TEAM)\"" '
        toupper($2) == hash && index($0, "\"Developer ID Application: ") &&
        substr($0, length($0) - length(team) + 1) == team { print; exit }
    ')"
    if [[ -z "$selected" ]]; then
        echo "Required Developer ID Application identity $requested for team $DEVELOPER_ID_TEAM is unavailable." >&2
        echo "Restore its matching certificate and private key; the legacy Certificates.p12 is not the G2 backup." >&2
        return 2
    fi
    DEVELOPER_ID_HASH="$requested"
    DEVELOPER_ID_NAME="${selected#*\"}"
    DEVELOPER_ID_NAME="${DEVELOPER_ID_NAME%\"*}"
} # End of select_developer_id()

# Verify the actual leaf certificate, since old and new certificates share a name.
verify_developer_id_signature() (
    local directory actual
    directory="$(mktemp -d "${TMPDIR:-/tmp}/developer-id-check.XXXXXX")" || exit 2
    trap 'rm -rf "$directory"' EXIT
    codesign --display --extract-certificates "$directory/cert" "$1" >/dev/null 2>&1 || exit 2
    actual="$(openssl x509 -inform DER -in "$directory/cert0" -noout -fingerprint -sha1)" || exit 2
    actual="$(printf '%s' "${actual#*=}" | tr -d ':' | tr '[:lower:]' '[:upper:]')"
    if [[ "$actual" != "$DEVELOPER_ID_HASH" ]]; then
        echo "Signed artifact does not use the selected Developer ID certificate: $1" >&2
        exit 2
    fi
) # End of verify_developer_id_signature()
