// Tests for the Wi-Fi network write rules and bodies (src/main/wifi-network-write.ts),
// against the contract fixture tests/fixtures/openapi/ssid-writes.json:
// - the SSID name: trimmed, at most 32 BYTES of UTF-8 (multi-byte boundary
//   cases), control / bidi characters refused;
// - the passphrase: 8–63 printable ASCII characters, never trimmed;
// - the create bodies (open and WPA-Personal): every required field present,
//   disabled, bound to the groups, the passphrase only when typed;
// - the read-merge-write of basic-config: BASIC_CONFIG_SCHEMA pinned against
//   the documented request schema (docs/omada-openapi-ops.md, top level and
//   nested); every documented field the fresh detail reports kept verbatim
//   (also settings the DTO never exposes, nested objects whole), only the
//   edited fields changed, undocumented keys (top level or nested) not sent,
//   absent optional fields left absent, a missing required field or a wrong
//   type refused (networkStateUnknown), the detail's own key never copied,
//   Enterprise / PPSK / unknown security refused, the re-typed passphrase
//   required for a WPA-Personal result;
// - security and bands as one dependent change (deriveSecurityDependents()):
//   one test per transition, every dependent byte-identical for a name /
//   passphrase edit, the Enhanced IoT Connectivity conflict, the create
//   bodies of every band mix, and an exhaustive consistency sweep;
// - the controller error table and the client's body sanity check.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  BASIC_CONFIG_KEYS,
  BASIC_CONFIG_SCHEMA,
  buildCreateSsidBody,
  buildEnableBody,
  checkNetworkCreate,
  checkNetworkEdits,
  deriveSecurityDependents,
  isSaneSsidWriteBody,
  MAX_PASSPHRASE_LENGTH,
  MAX_SSID_NAME_BYTES,
  mergeBasicConfig,
  MIN_PASSPHRASE_LENGTH,
  NETWORK_CONTROLLER_ERRORS,
  ssidBodySecrets,
  utf8ByteLength,
  validatePassphrase,
  validateSsidName,
  type CheckedNetworkEdits,
  type NetworkCreateInput,
  type NetworkEditsInput,
  type SchemaField
} from '../../src/main/wifi-network-write';
import type { NetworkBand, NetworkSecurity } from '../../src/shared/types';
import fixtures from '../fixtures/openapi/ssid-writes.json';

const [GROUP_A, GROUP_B] = fixtures.apGroupIds;
const DETAIL = fixtures.basicConfig.detail as Record<string, unknown>;
const CURRENT_KEY = 'fixture-current-key-NEVER-SENT';

/**
 * Checks edits that must pass and returns them.
 * @param {NetworkEditsInput} edits - The edits as sent.
 * @returns {CheckedNetworkEdits} The checked edits.
 */
function checked(edits: NetworkEditsInput): CheckedNetworkEdits {
  const result = checkNetworkEdits(edits);
  assert.ok(result.ok, JSON.stringify(result));
  return result.edits;
}

/**
 * Merges edits onto a detail and returns the body (the merge must pass).
 * @param {unknown} detail - The fresh detail.
 * @param {NetworkEditsInput} edits - The edits as sent.
 * @returns {Record<string, unknown>} The body.
 */
function merged(detail: unknown, edits: NetworkEditsInput): Record<string, unknown> {
  const result = mergeBasicConfig(detail, checked(edits));
  assert.ok(result.ok, JSON.stringify(result));
  return result.body;
}

/**
 * A create input with the given overrides.
 * @param {Partial<NetworkCreateInput>} overrides - Fields to replace.
 * @returns {NetworkCreateInput} The input.
 */
function createInput(overrides: Partial<NetworkCreateInput> = {}): NetworkCreateInput {
  return { name: 'Casa', security: 'wpaPersonal', bands: ['band2g'], apGroupIds: [GROUP_A], passphrase: 'clave-de-prueba', ...overrides };
}

// The bands in bit order (bit 0 2.4 GHz, bit 1 5 GHz, bit 2 6 GHz)
const BAND_LIST: NetworkBand[] = ['band2g', 'band5g', 'band6g'];

/**
 * The bands of a band mask.
 * @param {number} mask - The `band` mask (1–7).
 * @returns {NetworkBand[]} Its bands.
 */
function bandsOf(mask: number): NetworkBand[] {
  return BAND_LIST.filter((_band, bit) => (mask & (1 << bit)) !== 0);
}

/**
 * The security / band inconsistencies of a body, re-stated from the ops doc
 * and the Wi-Fi standards independently of the code under test: 6 GHz needs
 * WPA3-SAE (versionPsk 4) or OWE; WPA3-SAE needs AES; WPA3-SAE alone needs
 * PMF mandatory; WPA2/WPA3 transition uses PMF capable; WPA2-only is never
 * PMF mandatory; OWE belongs to open networks and needs PMF mandatory; an
 * open network without OWE has PMF disabled; Enhanced IoT Connectivity only
 * without 5 / 6 GHz and without versionPsk 4.
 * @param {Record<string, unknown>} body - A create or basic-config body.
 * @returns {string[]} The problems (none for a consistent body).
 */
function consistencyProblems(body: Record<string, unknown>): string[] {
  const problems: string[] = [];
  const band = body.band as number;
  const psk = body.pskSetting as Record<string, unknown> | undefined;
  const version = psk?.versionPsk;
  if ((band & 4) !== 0 && version !== 4 && body.oweEnable !== true) {
    problems.push('6 GHz without WPA3-SAE or OWE');
  }
  if (body.enhancedIotConnectivity === true && ((band & 6) !== 0 || version === 4)) {
    problems.push('Enhanced IoT Connectivity with 5 / 6 GHz or versionPsk 4');
  }
  if (body.security === 3) {
    if (psk === undefined) {
      problems.push('WPA-Personal without pskSetting');
    }
    if (version === 4 && psk?.encryptionPsk !== 3) {
      problems.push('WPA3-SAE without AES');
    }
    if (version === 4 && body.pmfMode !== (band === 4 ? 1 : 2)) {
      problems.push(band === 4 ? 'WPA3-SAE alone without PMF mandatory' : 'WPA2/WPA3 transition without PMF capable');
    }
    if (version !== 4 && body.pmfMode === 1) {
      problems.push('WPA2-only with PMF mandatory');
    }
    if (body.oweEnable === true) {
      problems.push('OWE on a WPA-Personal network');
    }
  } else {
    if (psk !== undefined) {
      problems.push('open network with pskSetting');
    }
    if (body.pmfMode !== (body.oweEnable === true ? 1 : 3)) {
      problems.push('open network PMF does not match OWE');
    }
  } // End of the per-security checks
  return problems;
} // End of function consistencyProblems()

/**
 * A fresh WPA-Personal detail (every other basic setting sane).
 * @param {number} band - The `band` mask.
 * @param {number} versionPsk - The WPA version.
 * @param {number} encryptionPsk - The encryption.
 * @param {number} pmfMode - The PMF mode.
 * @param {Record<string, unknown>} [extra] - Keys to add or replace.
 * @returns {Record<string, unknown>} The detail.
 */
function wpaDetail(band: number, versionPsk: number, encryptionPsk: number, pmfMode: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ssid-1',
    name: 'Casa',
    band,
    guestNetEnable: false,
    security: 3,
    oweEnable: false,
    broadcast: true,
    vlanEnable: false,
    mloEnable: false,
    pmfMode,
    enable11r: false,
    hidePwd: false,
    enhancedIotConnectivity: false,
    pskSetting: { securityKey: CURRENT_KEY, versionPsk, encryptionPsk, gikRekeyPskEnable: true, rekeyPskInterval: 2, intervalPskType: 2 },
    ...extra
  };
} // End of function wpaDetail()

/**
 * A fresh open detail (every other basic setting sane; no oweEnable unless given).
 * @param {number} band - The `band` mask.
 * @param {number} pmfMode - The PMF mode.
 * @param {Record<string, unknown>} [extra] - Keys to add or replace.
 * @returns {Record<string, unknown>} The detail.
 */
function openDetail(band: number, pmfMode: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'ssid-2', name: 'Invitados', band, guestNetEnable: false, security: 0, broadcast: true, vlanEnable: false, mloEnable: false, pmfMode, enable11r: false, hidePwd: false, ...extra };
}

/**
 * The documented basic-config fields of a detail as a body would carry them
 * unchanged: the schema's top-level keys the detail reports, without
 * `entSetting` / `ppskSetting`, `pskSetting` minus its key.
 * @param {Record<string, unknown>} detail - The detail (documented nested fields only).
 * @returns {Record<string, unknown>} The fields.
 */
function unchangedFields(detail: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const key of BASIC_CONFIG_KEYS) {
    if (key in detail && key !== 'entSetting' && key !== 'ppskSetting') {
      fields[key] = structuredClone(detail[key]);
    }
  }
  if (fields.pskSetting !== undefined) {
    delete (fields.pskSetting as Record<string, unknown>).securityKey;
  }
  return fields;
} // End of function unchangedFields()

describe('SSID names: trimmed, 1–32 bytes of UTF-8, no control or bidi characters', () => {
  test('utf8ByteLength() counts bytes per code point (1 / 2 / 3 / 4)', () => {
    assert.equal(utf8ByteLength(''), 0);
    assert.equal(utf8ByteLength('abc'), 3);
    assert.equal(utf8ByteLength('é'), 2);
    assert.equal(utf8ByteLength('€'), 3);
    assert.equal(utf8ByteLength('😀'), 4);
    assert.equal(utf8ByteLength('a\u{10348}é'), 7);
    assert.equal(utf8ByteLength('Señal Wi‑Fi'), Buffer.byteLength('Señal Wi‑Fi', 'utf8'));
  });

  test('boundaries: 32 bytes pass, 33 do not — ASCII, 2-byte, 3-byte and 4-byte characters and mixed', () => {
    const cases: Array<[string, boolean]> = [
      ['a'.repeat(32), true],
      ['a'.repeat(33), false],
      ['é'.repeat(16), true],
      ['é'.repeat(16) + 'a', false],
      ['é'.repeat(15) + 'ab', true],
      ['€'.repeat(10) + 'ab', true],
      ['€'.repeat(10) + 'abc', false],
      ['€'.repeat(11), false],
      ['😀'.repeat(8), true],
      ['😀'.repeat(8) + 'a', false],
      ['😀'.repeat(7) + 'éé', true],
      ['😀'.repeat(7) + 'é€', false]
    ];
    for (const [name, valid] of cases) {
      assert.equal(Buffer.byteLength(name, 'utf8') <= MAX_SSID_NAME_BYTES, valid, `fixture sanity: ${name}`);
      assert.deepEqual(validateSsidName(name), valid ? { ok: true, name } : { ok: false, error: 'nameTooLong' }, name);
    }
    // 16 characters of 2 bytes: within any character cap, over the byte cap
    assert.deepEqual(validateSsidName('ñ'.repeat(17)), { ok: false, error: 'nameTooLong' });
  }); // End of test "boundaries: 32 bytes pass, 33 do not..."

  test('trimmed before counting; blank is nameRequired; control, bidi, separators and unpaired surrogates are nameInvalid', () => {
    assert.deepEqual(validateSsidName(`  ${'a'.repeat(32)}\t `), { ok: true, name: 'a'.repeat(32) });
    for (const blank of ['', '   ', '\t\n']) {
      assert.deepEqual(validateSsidName(blank), { ok: false, error: 'nameRequired' }, JSON.stringify(blank));
    }
    for (const bad of ['Ca\u0000sa', 'Ca\u0007sa', 'Ca\nsa', 'Casa‮', 'Ca⁦sa', 'Ca‏sa', 'Ca sa', 'Ca\ud800sa']) {
      assert.deepEqual(validateSsidName(bad), { ok: false, error: 'nameInvalid' }, JSON.stringify(bad));
    }
    assert.deepEqual(validateSsidName('Café · Invitados 😀'), { ok: true, name: 'Café · Invitados 😀' });
  });
}); // End of the describe block for SSID names

describe('Passphrases: 8–63 printable ASCII characters, as typed', () => {
  test('length boundaries 7 / 8 / 63 / 64 (a 64-hex-digit raw key is not accepted)', () => {
    assert.equal(MIN_PASSPHRASE_LENGTH, 8);
    assert.equal(MAX_PASSPHRASE_LENGTH, 63);
    assert.deepEqual(validatePassphrase('a'.repeat(7)), { ok: false, error: 'passphraseInvalid' });
    assert.deepEqual(validatePassphrase('a'.repeat(8)), { ok: true, passphrase: 'a'.repeat(8) });
    assert.deepEqual(validatePassphrase('a'.repeat(63)), { ok: true, passphrase: 'a'.repeat(63) });
    assert.deepEqual(validatePassphrase('a'.repeat(64)), { ok: false, error: 'passphraseInvalid' });
    assert.deepEqual(validatePassphrase('0123456789abcdef'.repeat(4)), { ok: false, error: 'passphraseInvalid' });
    assert.deepEqual(validatePassphrase('0123456789abcdef'.repeat(3)), { ok: true, passphrase: '0123456789abcdef'.repeat(3) });
  });

  test('printable ASCII only (space and ~ included, never trimmed); non-ASCII, tabs, line breaks, DEL and non-strings refused', () => {
    assert.deepEqual(validatePassphrase(' ~!"#$%&\'()*+ '), { ok: true, passphrase: ' ~!"#$%&\'()*+ ' });
    for (const bad of ['contraseña1', 'clave\tsegura', 'clave\nsegura', 'clave\u007fsegura', 'claveñ€segura', 'clave😀segura']) {
      assert.deepEqual(validatePassphrase(bad), { ok: false, error: 'passphraseInvalid' }, JSON.stringify(bad));
    }
    for (const bad of [undefined, null, 12345678, ['12345678']]) {
      assert.deepEqual(validatePassphrase(bad), { ok: false, error: 'passphraseInvalid' }, String(bad));
    }
  });
}); // End of the describe block for passphrases

describe('Create: checkNetworkCreate() and buildCreateSsidBody() (fixtures)', () => {
  test('an open network: the exact body — every required field, disabled, bound to the (deduplicated) groups, no pskSetting', () => {
    const result = checkNetworkCreate(fixtures.create.open.input as NetworkCreateInput);
    assert.ok(result.ok);
    assert.deepEqual(buildCreateSsidBody(result.create), fixtures.create.open.body);
  });

  test('a WPA-Personal network: the exact body — pskSetting with the passphrase as typed and every required WPA field', () => {
    const result = checkNetworkCreate(fixtures.create.wpaPersonal.input as NetworkCreateInput);
    assert.ok(result.ok);
    const body = buildCreateSsidBody(result.create);
    assert.deepEqual(body, fixtures.create.wpaPersonal.body);
    assert.deepEqual(ssidBodySecrets(body), [' fixture pass 2! ']);
    assert.equal(isSaneSsidWriteBody(body), true);
  });

  test('every field the ops doc marks required is present in both bodies', () => {
    const required = ['name', 'deviceType', 'band', 'guestNetEnable', 'security', 'broadcast', 'vlanEnable', 'mloEnable', 'pmfMode', 'enable11r', 'hidePwd'];
    for (const body of [fixtures.create.open.body, fixtures.create.wpaPersonal.body]) {
      for (const key of required) {
        assert.ok(Object.prototype.hasOwnProperty.call(body, key), key);
      }
      assert.equal(body.ssidEnable, false, 'created disabled');
      assert.equal(body.chooseDevices, 1, 'bound to the selected groups');
    }
    for (const key of ['securityKey', 'versionPsk', 'encryptionPsk', 'gikRekeyPskEnable']) {
      assert.ok(Object.prototype.hasOwnProperty.call(fixtures.create.wpaPersonal.body.pskSetting, key), key);
    }
  }); // End of test "every field the ops doc..."

  test('create for each band mix (the derivation table): a consistent body for every WPA-Personal mix and every open mix without 6 GHz; open with 6 GHz → securityBandConflict (the create request has no oweEnable)', () => {
    const expectedWpa: Record<number, { versionPsk: number; pmfMode: number }> = {
      1: { versionPsk: 2, pmfMode: 2 },
      2: { versionPsk: 2, pmfMode: 2 },
      3: { versionPsk: 2, pmfMode: 2 },
      4: { versionPsk: 4, pmfMode: 1 },
      5: { versionPsk: 4, pmfMode: 2 },
      6: { versionPsk: 4, pmfMode: 2 },
      7: { versionPsk: 4, pmfMode: 2 }
    };
    for (let mask = 1; mask <= 7; mask++) {
      const bands = bandsOf(mask);
      const wpa = checkNetworkCreate(createInput({ bands }));
      assert.ok(wpa.ok, JSON.stringify(wpa));
      const wpaBody = buildCreateSsidBody(wpa.create);
      assert.equal(wpaBody.band, mask);
      assert.equal(wpaBody.pmfMode, expectedWpa[mask].pmfMode, `WPA ${mask} pmfMode`);
      assert.deepEqual(wpaBody.pskSetting, { securityKey: 'clave-de-prueba', versionPsk: expectedWpa[mask].versionPsk, encryptionPsk: 3, gikRekeyPskEnable: false }, `WPA ${mask}`);
      assert.equal('oweEnable' in wpaBody, false, 'a create never carries oweEnable (not in the create request)');
      assert.deepEqual(consistencyProblems(wpaBody), [], `WPA ${mask}`);
      const open = checkNetworkCreate(createInput({ bands, security: 'open', passphrase: undefined }));
      if ((mask & 4) !== 0) {
        assert.deepEqual(open, { ok: false, error: 'securityBandConflict', diagnostic: 'conflict: oweEnable' }, `open ${mask}`);
        continue;
      }
      assert.ok(open.ok, JSON.stringify(open));
      const openBody = buildCreateSsidBody(open.create);
      assert.equal(openBody.pmfMode, 3, `open ${mask}: PMF disabled`);
      assert.equal('oweEnable' in openBody || 'pskSetting' in openBody, false);
      assert.deepEqual(consistencyProblems(openBody), [], `open ${mask}`);
    } // End of the loop over the band masks
    // The conflict is answered before the groups and the passphrase rules
    assert.deepEqual(checkNetworkCreate(createInput({ bands: ['band6g'], security: 'open', apGroupIds: [] })), { ok: false, error: 'securityBandConflict', diagnostic: 'conflict: oweEnable' });
  }); // End of test "create for each band mix..."

  test('the passphrase only when typed: open + a passphrase → passphraseNotApplicable; WPA-Personal without one (absent or empty) → passphraseRequired; malformed → passphraseInvalid', () => {
    assert.deepEqual(checkNetworkCreate(createInput({ security: 'open', passphrase: 'clave-de-prueba' })), { ok: false, error: 'passphraseNotApplicable' });
    const open = checkNetworkCreate(createInput({ security: 'open', passphrase: '' }));
    assert.ok(open.ok && open.create.passphrase === undefined, 'an empty passphrase counts as not typed');
    assert.deepEqual(checkNetworkCreate(createInput({ passphrase: undefined })), { ok: false, error: 'passphraseRequired' });
    assert.deepEqual(checkNetworkCreate(createInput({ passphrase: '' })), { ok: false, error: 'passphraseRequired' });
    assert.deepEqual(checkNetworkCreate(createInput({ passphrase: 'corta' })), { ok: false, error: 'passphraseInvalid' });
    assert.deepEqual(checkNetworkCreate(createInput({ passphrase: 'x'.repeat(64) })), { ok: false, error: 'passphraseInvalid' });
  });

  test('Enterprise, PPSK and unknown security are refused (unsupportedSecurity); no band, no group, a bad group id and the name rules answer with codes', () => {
    for (const security of ['wpaEnterprise', 'ppskWithoutRadius', 'ppskWithRadius', 'unknown', 'wep'] as NetworkSecurity[]) {
      assert.deepEqual(checkNetworkCreate(createInput({ security })), { ok: false, error: 'unsupportedSecurity' }, security);
    }
    assert.deepEqual(checkNetworkCreate(createInput({ bands: [] })), { ok: false, error: 'bandsRequired' });
    assert.deepEqual(checkNetworkCreate(createInput({ apGroupIds: [] })), { ok: false, error: 'groupsRequired' });
    assert.deepEqual(checkNetworkCreate(createInput({ apGroupIds: [GROUP_A, 'Corrupto'] })), { ok: false, error: 'groupNotFound' });
    assert.deepEqual(checkNetworkCreate(createInput({ name: '  ' })), { ok: false, error: 'nameRequired' });
    assert.deepEqual(checkNetworkCreate(createInput({ name: 'é'.repeat(17) })), { ok: false, error: 'nameTooLong' });
    assert.deepEqual(checkNetworkCreate(createInput({ name: 'Casa‮' })), { ok: false, error: 'nameInvalid' });
  }); // End of test "Enterprise, PPSK and unknown security..."
}); // End of the describe block for create

describe('Read-merge-write: mergeBasicConfig() (fixtures)', () => {
  test('an edit: every documented key the fresh detail reports is kept verbatim, only the edited fields change, the typed passphrase replaces the key', () => {
    const body = merged(DETAIL, fixtures.basicConfig.edit.edits as NetworkEditsInput);
    assert.deepEqual(body, fixtures.basicConfig.edit.body);
  });

  test('every unedited setting the detail returned survives — also the ones outside the DTO (VLAN, hidden, guest, PMF, 802.11r, MLO, OWE, rekeying, conditional broadcast)', () => {
    const body = merged(DETAIL, { name: 'Casa 2', passphrase: 'fixture-new-passphrase-1' });
    for (const key of BASIC_CONFIG_KEYS) {
      if (['name', 'pskSetting', 'entSetting', 'ppskSetting'].includes(key) || !(key in DETAIL)) {
        continue;
      }
      assert.deepEqual(body[key], DETAIL[key], key);
    }
    const psk = { ...(DETAIL.pskSetting as Record<string, unknown>) };
    delete psk.securityKey;
    assert.deepEqual(body.pskSetting, { ...psk, securityKey: 'fixture-new-passphrase-1' });
  }); // End of test "every unedited setting the detail..."

  test('keys basic-config does not document (bindings, enable state, rate limits, schedule, …) and the Enterprise / PPSK settings are not sent; the detail is not mutated', () => {
    const before = structuredClone(DETAIL);
    const body = merged(DETAIL, { name: 'Casa 2', passphrase: 'fixture-new-passphrase-1' });
    for (const key of Object.keys(body)) {
      assert.ok(BASIC_CONFIG_KEYS.includes(key), `${key} is a documented basic-config key`);
    }
    for (const key of ['id', 'ssidId', 'apGroupIds', 'chooseDevices', 'ssidEnable', 'deviceType', 'clientRateLimit', 'wlanSchedule', 'macFilter', 'unknownFutureField', 'entSetting', 'ppskSetting']) {
      assert.equal(key in body, false, key);
    }
    assert.deepEqual(DETAIL, before);
  }); // End of test "keys basic-config does not document..."

  test('the detail\'s own key is never copied into a body (any edit, any result); an open result carries no pskSetting at all', () => {
    for (const edits of [{ name: 'X', passphrase: 'clave-nueva-1' }, { security: 'open' }, { passphrase: 'clave-nueva-1' }] as NetworkEditsInput[]) {
      const body = merged(DETAIL, edits);
      assert.ok(!JSON.stringify(body).includes(CURRENT_KEY), JSON.stringify(edits));
    }
    assert.deepEqual(merged(DETAIL, fixtures.basicConfig.toOpen.edits as NetworkEditsInput), fixtures.basicConfig.toOpen.body);
  });

  test('a WPA-Personal result needs the re-typed passphrase (spec §3): a name / band / security edit without it → passphraseRequired; with it, saved', () => {
    for (const edits of [{ name: 'Casa 2' }, { bands: ['band5g'] }, { security: 'wpaPersonal' }] as NetworkEditsInput[]) {
      assert.deepEqual(mergeBasicConfig(DETAIL, checked(edits)), { ok: false, error: 'passphraseRequired' }, JSON.stringify(edits));
      assert.equal(mergeBasicConfig(DETAIL, checked({ ...edits, passphrase: 'clave-nueva-1' })).ok, true);
    }
    // Also when the detail reports no key at all (withheld)
    const withheld = { ...DETAIL, pskSetting: { versionPsk: 2, encryptionPsk: 3, gikRekeyPskEnable: false } };
    assert.deepEqual(mergeBasicConfig(withheld, checked({ name: 'Casa 2' })), { ok: false, error: 'passphraseRequired' });
  });

  test('open ↔ WPA-Personal: to open drops the WPA settings (a typed passphrase is passphraseNotApplicable); to WPA-Personal needs one and gets the app defaults for missing settings', () => {
    assert.deepEqual(mergeBasicConfig(DETAIL, checked({ security: 'open', passphrase: 'clave-nueva-1' })), { ok: false, error: 'passphraseNotApplicable' });
    const openDetail = { ...structuredClone(DETAIL), security: 0, pskSetting: undefined, band: 4 };
    assert.deepEqual(mergeBasicConfig(openDetail, checked({ name: 'Abierta', passphrase: 'clave-nueva-1' })), { ok: false, error: 'passphraseNotApplicable' });
    assert.deepEqual(mergeBasicConfig(openDetail, checked({ security: 'wpaPersonal' })), { ok: false, error: 'passphraseRequired' });
    const body = merged(openDetail, { security: 'wpaPersonal', passphrase: 'clave-nueva-1' });
    assert.equal(body.security, 3);
    assert.deepEqual(body.pskSetting, { versionPsk: 4, encryptionPsk: 3, gikRekeyPskEnable: false, securityKey: 'clave-nueva-1' }, '6 GHz: WPA2/WPA3');
    // A stale but sane pskSetting of the open network is reused (minus its key)
    const stale = { ...openDetail, band: 3, pskSetting: { securityKey: CURRENT_KEY, versionPsk: 3, encryptionPsk: 1, gikRekeyPskEnable: true, rekeyPskInterval: 2 } };
    assert.deepEqual(merged(stale, { security: 'wpaPersonal', passphrase: 'clave-nueva-1' }).pskSetting, {
      versionPsk: 3,
      encryptionPsk: 1,
      gikRekeyPskEnable: true,
      rekeyPskInterval: 2,
      securityKey: 'clave-nueva-1'
    });
    // An edit of an open network keeps it open, without any pskSetting
    assert.deepEqual(merged(openDetail, { name: 'Abierta' }).pskSetting, undefined);
  }); // End of test "open ↔ WPA-Personal..."

  test('Enterprise, PPSK or unknown security on the FRESH detail → unsupportedSecurity, whatever the edit asks for', () => {
    for (const security of [2, 4, 5, 1, 9, '3', null, undefined]) {
      const detail = { ...DETAIL, security };
      for (const edits of [{ name: 'X', passphrase: 'clave-nueva-1' }, { security: 'open' }, { security: 'wpaPersonal', passphrase: 'clave-nueva-1' }] as NetworkEditsInput[]) {
        assert.deepEqual(mergeBasicConfig(detail, checked(edits)), { ok: false, error: 'unsupportedSecurity' }, `${String(security)} ${JSON.stringify(edits)}`);
      }
    }
  });

  test('a required setting the detail does not report sanely is never invented: networkStateUnknown', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['no broadcast', { broadcast: undefined }],
      ['guestNetEnable not a boolean', { guestNetEnable: 'no' }],
      ['no vlanEnable', { vlanEnable: null }],
      ['no mloEnable', { mloEnable: undefined }],
      ['pmfMode out of range', { pmfMode: 4 }],
      ['no enable11r', { enable11r: undefined }],
      ['VLAN on without vlanId or vlanSetting', { vlanId: null, vlanSetting: null }],
      ['band 0 (not edited)', { band: 0 }],
      ['no name (not edited)', { name: undefined }],
      ['WPA without versionPsk', { pskSetting: { securityKey: CURRENT_KEY, encryptionPsk: 3, gikRekeyPskEnable: false } }],
      ['WPA with a garbage encryptionPsk', { pskSetting: { versionPsk: 2, encryptionPsk: 2, gikRekeyPskEnable: false } }],
      ['WPA with pskSetting not an object', { pskSetting: 'x' }]
    ];
    for (const [label, change] of cases) {
      const detail = { ...structuredClone(DETAIL), ...change };
      assert.deepEqual(mergeBasicConfig(detail, checked({ passphrase: 'clave-nueva-1' })), { ok: false, error: 'networkStateUnknown' }, label);
    }
    assert.deepEqual(mergeBasicConfig(null, checked({ name: 'X' })), { ok: false, error: 'networkStateUnknown' });
    assert.deepEqual(mergeBasicConfig([DETAIL], checked({ name: 'X' })), { ok: false, error: 'networkStateUnknown' });
    // The edit itself can supply an unreported name or band
    assert.equal(mergeBasicConfig({ ...DETAIL, band: 0, name: undefined }, checked({ name: 'X', bands: ['band2g'], passphrase: 'clave-nueva-1' })).ok, true);
  }); // End of test "a required setting the detail does not report sanely..."
}); // End of the describe block for read-merge-write

// A fresh detail carrying EVERY field of the basic-config request schema
// (nested ones included), plus keys the schema does not document at every
// level (top level, inside pskSetting, vlanSetting, customConfig and
// CondBroadcastCtrl) and detail-only settings of other endpoints
const FULL_DETAIL: Record<string, unknown> = {
  id: '5f00c0ffee0000000000c001',
  name: 'Casa',
  band: 3,
  autoWanAccess: true,
  guestNetEnable: true,
  security: 3,
  oweEnable: false,
  broadcast: false,
  vlanEnable: true,
  vlanId: null,
  pskSetting: { securityKey: CURRENT_KEY, versionPsk: 3, encryptionPsk: 1, gikRekeyPskEnable: true, rekeyPskInterval: 45, intervalPskType: 1, futurePsk: 'x' },
  entSetting: { radiusProfileId: 'radius-1', versionEnt: 2, encryptionEnt: 3, gikRekeyEntEnable: false },
  ppskSetting: { ppskProfileId: 'ppsk-1' },
  mloEnable: true,
  pmfMode: 2,
  enable11r: true,
  hidePwd: true,
  greEnable: true,
  vlanSetting: {
    mode: 1,
    customConfig: { customMode: 0, lanNetworkId: 'lan-net-1', bridgeVlan: 30, vlanId: 20, lanNetworkVlanIds: { 'lan-net-1': [20, 30] }, vlanPoolIds: '20,30', futureCustom: 'x' },
    futureVlan: true
  },
  prohibitWifiShare: true,
  enhancedIotConnectivity: false,
  CondBroadcastCtrl: { enable: true, condition: 0, upTime: 5, downTime: 15, futureCondition: 1 },
  clientRateLimit: { profileId: 'rate-1' },
  wlanSchedule: { wlanScheduleEnable: true, scheduleId: 'schedule-1' },
  macFilter: { macFilterEnable: true, policy: 1 },
  dhcpOption82: { dhcpEnable: true },
  apGroupIds: [GROUP_A],
  ssidEnable: true,
  futureTopLevel: { x: 1 }
};

// What a basic-config body keeps of FULL_DETAIL: exactly the documented
// fields (the undocumented nested keys dropped), no entSetting / ppskSetting,
// pskSetting without the stored key
const FULL_DETAIL_BASIC_CONFIG: Record<string, unknown> = {
  name: 'Casa',
  band: 3,
  autoWanAccess: true,
  guestNetEnable: true,
  security: 3,
  oweEnable: false,
  broadcast: false,
  vlanEnable: true,
  vlanId: null,
  pskSetting: { versionPsk: 3, encryptionPsk: 1, gikRekeyPskEnable: true, rekeyPskInterval: 45, intervalPskType: 1 },
  mloEnable: true,
  pmfMode: 2,
  enable11r: true,
  hidePwd: true,
  greEnable: true,
  vlanSetting: { mode: 1, customConfig: { customMode: 0, lanNetworkId: 'lan-net-1', bridgeVlan: 30, vlanId: 20, lanNetworkVlanIds: { 'lan-net-1': [20, 30] }, vlanPoolIds: '20,30' } },
  prohibitWifiShare: true,
  enhancedIotConnectivity: false,
  CondBroadcastCtrl: { enable: true, condition: 0, upTime: 5, downTime: 15 }
};

/**
 * Flattens a request schema to "path:type" entries ("*" marks required).
 * @param {readonly SchemaField[]} fields - The schema.
 * @param {string} prefix - The parent path ("" at the top).
 * @returns {string[]} The entries, in order.
 */
function flattenSchema(fields: readonly SchemaField[], prefix: string): string[] {
  return fields.flatMap((field) => [`${prefix}${field.key}:${field.type}${field.required ? '*' : ''}`, ...flattenSchema(field.fields ?? [], `${prefix}${field.key}.`)]);
}

/**
 * The documented request schema of PATCH …/basic-config, read from
 * docs/omada-openapi-ops.md (the "Request body" block of its section) as
 * "path:type" entries ("*" marks required), nested by indentation.
 * @returns {string[]} The entries, in documented order.
 */
function documentedBasicConfigSchema(): string[] {
  const doc = readFileSync(path.join(process.cwd(), 'docs', 'omada-openapi-ops.md'), 'utf8');
  const section = doc.split('\n## ').find((part) => part.startsWith('PATCH /openapi/v1/{omadacId}/sites/{siteId}/wireless-network/ssids/{ssidId}/basic-config'));
  assert.ok(section, 'the basic-config section of the ops doc');
  const block = section.split('Request body (* = required):\n```\n')[1]?.split('\n```')[0];
  assert.ok(block, 'its request body block');
  const entries: string[] = [];
  const parents: string[] = [];
  for (const line of block.split('\n')) {
    const match = /^( *)- ([A-Za-z0-9_]+)(\*?): ([A-Za-z<>]+) —/.exec(line);
    assert.ok(match, `a documented field line: ${line}`);
    parents.length = match[1].length / 2;
    parents.push(match[2]);
    entries.push(`${parents.join('.')}:${match[4]}${match[3]}`);
  } // End of the loop over the documented field lines
  return entries;
} // End of function documentedBasicConfigSchema()

describe('basic-config: exactly the documented request schema (docs/omada-openapi-ops.md)', () => {
  test('BASIC_CONFIG_SCHEMA is the documented request schema, top level AND nested (keys, types, required marks, order): any drift fails', () => {
    assert.deepEqual(flattenSchema(BASIC_CONFIG_SCHEMA, ''), documentedBasicConfigSchema());
    assert.deepEqual(BASIC_CONFIG_KEYS, [
      'name', 'band', 'autoWanAccess', 'guestNetEnable', 'security', 'oweEnable', 'broadcast', 'vlanEnable', 'vlanId', 'pskSetting', 'entSetting',
      'ppskSetting', 'mloEnable', 'pmfMode', 'enable11r', 'hidePwd', 'greEnable', 'vlanSetting', 'prohibitWifiShare', 'enhancedIotConnectivity', 'CondBroadcastCtrl'
    ]);
  });

  test('a detail carrying every schema field round-trips unchanged except the edited fields — nested objects whole (customConfig, CondBroadcastCtrl), undocumented keys at every level dropped', () => {
    const before = structuredClone(FULL_DETAIL);
    assert.deepEqual(merged(FULL_DETAIL, { name: 'Casa 2', passphrase: 'clave-nueva-1' }), {
      ...FULL_DETAIL_BASIC_CONFIG,
      name: 'Casa 2',
      pskSetting: { ...(FULL_DETAIL_BASIC_CONFIG.pskSetting as Record<string, unknown>), securityKey: 'clave-nueva-1' }
    });
    // "Change password": the passphrase only
    assert.deepEqual(merged(FULL_DETAIL, { passphrase: 'clave-nueva-2' }), {
      ...FULL_DETAIL_BASIC_CONFIG,
      pskSetting: { ...(FULL_DETAIL_BASIC_CONFIG.pskSetting as Record<string, unknown>), securityKey: 'clave-nueva-2' }
    });
    // The same security and bands sent again are no change either
    assert.deepEqual(merged(FULL_DETAIL, { name: 'Casa', security: 'wpaPersonal', bands: ['band5g', 'band2g'], passphrase: 'clave-nueva-1' }), {
      ...FULL_DETAIL_BASIC_CONFIG,
      pskSetting: { ...(FULL_DETAIL_BASIC_CONFIG.pskSetting as Record<string, unknown>), securityKey: 'clave-nueva-1' }
    });
    assert.deepEqual(FULL_DETAIL, before, 'the detail is not mutated');
  }); // End of test "a detail carrying every schema field round-trips..."

  test('optional fields the detail does not report stay absent (never invented); nulls are copied verbatim', () => {
    const minimal = { name: 'Mínima', band: 1, guestNetEnable: false, security: 0, broadcast: true, vlanEnable: false, mloEnable: false, pmfMode: 3, enable11r: false };
    assert.deepEqual(merged(minimal, { name: 'Mínima 2' }), { ...minimal, name: 'Mínima 2' });
    const withNulls = { ...minimal, autoWanAccess: null, hidePwd: null, vlanSetting: null, CondBroadcastCtrl: null, vlanId: null };
    assert.deepEqual(merged(withNulls, { name: 'Mínima 2' }), { ...withNulls, name: 'Mínima 2' });
    const wpaMinimal = { ...minimal, security: 3, pmfMode: 2, pskSetting: { versionPsk: 2, encryptionPsk: 3, gikRekeyPskEnable: false } };
    assert.deepEqual(merged(wpaMinimal, { passphrase: 'clave-nueva-1' }), { ...wpaMinimal, pskSetting: { versionPsk: 2, encryptionPsk: 3, gikRekeyPskEnable: false, securityKey: 'clave-nueva-1' } });
  });

  test('every required field missing (absent or null) → networkStateUnknown, never a default; also the WPA-Personal pskSetting trio', () => {
    for (const key of ['name', 'band', 'guestNetEnable', 'broadcast', 'vlanEnable', 'mloEnable', 'pmfMode', 'enable11r']) {
      for (const missing of [undefined, null]) {
        const detail = { ...structuredClone(FULL_DETAIL), [key]: missing };
        assert.deepEqual(mergeBasicConfig(detail, checked({ passphrase: 'clave-nueva-1' })), { ok: false, error: 'networkStateUnknown' }, `${key} ${String(missing)}`);
      }
    }
    for (const key of ['versionPsk', 'encryptionPsk', 'gikRekeyPskEnable']) {
      const pskSetting = { ...(FULL_DETAIL.pskSetting as Record<string, unknown>), [key]: null };
      assert.deepEqual(mergeBasicConfig({ ...FULL_DETAIL, pskSetting }, checked({ passphrase: 'clave-nueva-1' })), { ok: false, error: 'networkStateUnknown' }, `pskSetting.${key}`);
    }
    // A documented nested required field inside a reported object too
    const noMode = { ...FULL_DETAIL, vlanSetting: { customConfig: { customMode: 1 } } };
    assert.deepEqual(mergeBasicConfig(noMode, checked({ passphrase: 'clave-nueva-1' })), { ok: false, error: 'networkStateUnknown' }, 'vlanSetting.mode');
    const noCustomMode = { ...FULL_DETAIL, vlanSetting: { mode: 1, customConfig: { vlanId: 20 } } };
    assert.deepEqual(mergeBasicConfig(noCustomMode, checked({ passphrase: 'clave-nueva-1' })), { ok: false, error: 'networkStateUnknown' }, 'customConfig.customMode');
  }); // End of test "every required field missing..."

  test('a schema field of the wrong type (top level or nested, required or optional) → networkStateUnknown, nothing merged', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['name a number', { name: 7 }],
      ['band a string', { band: '3' }],
      ['band a fraction', { band: 1.5 }],
      ['autoWanAccess a string', { autoWanAccess: 'true' }],
      ['oweEnable a number', { oweEnable: 0 }],
      ['vlanId a string', { vlanId: '20' }],
      ['hidePwd a number', { hidePwd: 1 }],
      ['greEnable a string', { greEnable: 'no' }],
      ['prohibitWifiShare an object', { prohibitWifiShare: {} }],
      ['enhancedIotConnectivity a string', { enhancedIotConnectivity: 'false' }],
      ['vlanSetting an array', { vlanSetting: [1] }],
      ['vlanSetting.mode a string', { vlanSetting: { mode: '1' } }],
      ['customConfig a string', { vlanSetting: { mode: 1, customConfig: 'x' } }],
      ['customConfig.bridgeVlan a string', { vlanSetting: { mode: 1, customConfig: { customMode: 0, bridgeVlan: '30' } } }],
      ['customConfig.lanNetworkVlanIds an array', { vlanSetting: { mode: 1, customConfig: { customMode: 0, lanNetworkVlanIds: [] } } }],
      ['CondBroadcastCtrl a boolean', { CondBroadcastCtrl: true }],
      ['CondBroadcastCtrl.upTime a string', { CondBroadcastCtrl: { enable: true, upTime: '5' } }],
      ['pskSetting.rekeyPskInterval a string', { pskSetting: { versionPsk: 2, encryptionPsk: 3, gikRekeyPskEnable: true, rekeyPskInterval: '60' } }],
      ['pskSetting.gikRekeyPskEnable a number', { pskSetting: { versionPsk: 2, encryptionPsk: 3, gikRekeyPskEnable: 1 } }]
    ];
    for (const [label, change] of cases) {
      const detail = { ...structuredClone(FULL_DETAIL), ...change };
      assert.deepEqual(mergeBasicConfig(detail, checked({ passphrase: 'clave-nueva-1' })), { ok: false, error: 'networkStateUnknown' }, label);
    }
    // The Enterprise / PPSK settings are never sent, so their content is not judged
    assert.equal(mergeBasicConfig({ ...FULL_DETAIL, entSetting: 'garbage', ppskSetting: 7 }, checked({ passphrase: 'clave-nueva-1' })).ok, true);
  }); // End of test "a schema field of the wrong type..."
}); // End of the describe block for the basic-config schema

describe('Security and bands: one dependent change (deriveSecurityDependents())', () => {
  const PASS = 'clave-nueva-1';

  test('open → WPA-Personal without 6 GHz: WPA2-PSK / AES, a still-valid PMF kept (disabled), OWE-on PMF mandatory → capable and OWE off', () => {
    const body = merged(openDetail(3, 3), { security: 'wpaPersonal', passphrase: PASS });
    assert.equal(body.security, 3);
    assert.equal(body.pmfMode, 3, 'PMF disabled stays valid for WPA2-PSK');
    assert.equal('oweEnable' in body, false, 'absent stays absent');
    assert.deepEqual(body.pskSetting, { versionPsk: 2, encryptionPsk: 3, gikRekeyPskEnable: false, securityKey: PASS });
    const withOwe = merged(openDetail(1, 1, { oweEnable: true }), { security: 'wpaPersonal', bands: ['band2g', 'band5g'], passphrase: PASS });
    assert.equal(withOwe.pmfMode, 2, 'WPA2-only is never PMF mandatory');
    assert.equal(withOwe.oweEnable, false, 'OWE belongs to open networks');
    assert.deepEqual(consistencyProblems(body), []);
    assert.deepEqual(consistencyProblems(withOwe), []);
  });

  test('open → WPA-Personal with 6 GHz: WPA2-PSK/WPA3-SAE + AES; PMF capable with other bands, mandatory on 6 GHz only', () => {
    const mixed = merged(openDetail(7, 1, { oweEnable: true }), { security: 'wpaPersonal', passphrase: PASS });
    assert.deepEqual(mixed.pskSetting, { versionPsk: 4, encryptionPsk: 3, gikRekeyPskEnable: false, securityKey: PASS });
    assert.equal(mixed.pmfMode, 2);
    assert.equal(mixed.oweEnable, false);
    const sixOnly = merged(openDetail(3, 3), { security: 'wpaPersonal', bands: ['band6g'], passphrase: PASS });
    assert.deepEqual(sixOnly.pskSetting, { versionPsk: 4, encryptionPsk: 3, gikRekeyPskEnable: false, securityKey: PASS });
    assert.equal(sixOnly.pmfMode, 1);
    // A stale WPA2-only setting of the open network is not valid on 6 GHz
    const stale = merged(openDetail(1, 3, { pskSetting: { versionPsk: 2, encryptionPsk: 1, gikRekeyPskEnable: true } }), { security: 'wpaPersonal', bands: ['band2g', 'band6g'], passphrase: PASS });
    assert.deepEqual(stale.pskSetting, { versionPsk: 4, encryptionPsk: 3, gikRekeyPskEnable: true, securityKey: PASS });
    for (const body of [mixed, sixOnly, stale]) {
      assert.deepEqual(consistencyProblems(body), []);
    }
  }); // End of test "open → WPA-Personal with 6 GHz..."

  test('WPA-Personal → open with 6 GHz present: OWE on, PMF mandatory, no pskSetting (also when the detail reported no oweEnable)', () => {
    const body = merged(wpaDetail(7, 4, 3, 2), { security: 'open' });
    assert.equal(body.security, 0);
    assert.equal(body.oweEnable, true);
    assert.equal(body.pmfMode, 1);
    assert.equal('pskSetting' in body, false);
    const sixOnly = wpaDetail(4, 4, 3, 1);
    delete sixOnly.oweEnable;
    const opened = merged(sixOnly, { security: 'open' });
    assert.equal(opened.oweEnable, true, 'required by the result, so set');
    assert.equal(opened.pmfMode, 1);
    assert.deepEqual(consistencyProblems(body), []);
    assert.deepEqual(consistencyProblems(opened), []);
  });

  test('WPA-Personal → open with 6 GHz absent: a WPA3 PMF mode is not kept (disabled); OWE left as reported (off or absent)', () => {
    const body = merged(wpaDetail(3, 4, 3, 1), { security: 'open' });
    assert.equal(body.pmfMode, 3);
    assert.equal(body.oweEnable, false);
    assert.equal('pskSetting' in body, false);
    const noOwe = wpaDetail(3, 2, 1, 2);
    delete noOwe.oweEnable;
    const opened = merged(noOwe, { security: 'open', bands: ['band2g'] });
    assert.equal(opened.pmfMode, 3);
    assert.equal('oweEnable' in opened, false);
    assert.deepEqual(consistencyProblems(body), []);
    assert.deepEqual(consistencyProblems(opened), []);
  });

  test('a WPA2-PSK network gaining 6 GHz: versionPsk 4 + AES (Auto is not allowed), PMF capable (mandatory on 6 GHz only); the group-key settings kept', () => {
    const body = merged(wpaDetail(3, 2, 1, 3), { bands: ['band2g', 'band5g', 'band6g'], passphrase: PASS });
    assert.deepEqual(body.pskSetting, { versionPsk: 4, encryptionPsk: 3, gikRekeyPskEnable: true, rekeyPskInterval: 2, intervalPskType: 2, securityKey: PASS });
    assert.equal(body.pmfMode, 2);
    const sixOnly = merged(wpaDetail(3, 2, 1, 3), { bands: ['band6g'], passphrase: PASS });
    assert.equal((sixOnly.pskSetting as Record<string, unknown>).versionPsk, 4);
    assert.equal(sixOnly.pmfMode, 1);
    assert.deepEqual(consistencyProblems(body), []);
    assert.deepEqual(consistencyProblems(sixOnly), []);
  });

  test('a WPA3 network losing 6 GHz: versionPsk 4 stays (WPA2-PSK/WPA3-SAE on 2.4 / 5 GHz), AES kept, PMF mandatory → capable (transition mode)', () => {
    const body = merged(wpaDetail(4, 4, 3, 1), { bands: ['band2g', 'band5g'], passphrase: PASS });
    assert.deepEqual(body.pskSetting, { versionPsk: 4, encryptionPsk: 3, gikRekeyPskEnable: true, rekeyPskInterval: 2, intervalPskType: 2, securityKey: PASS });
    assert.equal(body.pmfMode, 2);
    assert.deepEqual(consistencyProblems(body), []);
    // A WPA2/WPA3 network on every band losing 6 GHz keeps everything
    const mixed = merged(wpaDetail(7, 4, 3, 2), { bands: ['band2g', 'band5g'], passphrase: PASS });
    assert.deepEqual(unchangedFields(mixed), { ...unchangedFields(wpaDetail(7, 4, 3, 2)), band: 3 });
  });

  test('a band change whose dependents stay valid keeps them byte-identical (WPA/WPA2-PSK + Auto + PMF disabled on 2.4 → 2.4 + 5 GHz)', () => {
    const detail = wpaDetail(1, 3, 1, 3);
    assert.deepEqual(unchangedFields(merged(detail, { bands: ['band2g', 'band5g'], passphrase: PASS })), { ...unchangedFields(detail), band: 3 });
  });

  test('a name or passphrase edit keeps every dependent byte-identical — even a reported state the table would not produce', () => {
    const odd = wpaDetail(7, 2, 1, 1, { oweEnable: true, enhancedIotConnectivity: true });
    for (const edits of [{ name: 'Casa 2', passphrase: PASS }, { passphrase: PASS }, { name: 'Casa 2', bands: ['band2g', 'band5g', 'band6g'], security: 'wpaPersonal', passphrase: PASS }] as NetworkEditsInput[]) {
      const body = merged(odd, edits);
      const expected = { ...unchangedFields(odd), name: edits.name === undefined ? 'Casa' : 'Casa 2' };
      assert.deepEqual(unchangedFields(body), expected, JSON.stringify(edits));
      assert.equal((body.pskSetting as Record<string, unknown>).securityKey, PASS);
    }
    const oddOpen = openDetail(4, 2, { oweEnable: false });
    assert.deepEqual(merged(oddOpen, { name: 'Abierta' }), { ...unchangedFields(oddOpen), name: 'Abierta' });
  }); // End of test "a name or passphrase edit keeps every dependent..."

  test('Enhanced IoT Connectivity on (a setting outside the editable set) is never flipped: adding 5 / 6 GHz or needing versionPsk 4 → securityBandConflict naming the field', () => {
    const iot = wpaDetail(1, 2, 3, 2, { enhancedIotConnectivity: true });
    const refusal = { ok: false, error: 'securityBandConflict', diagnostic: 'conflict: enhancedIotConnectivity' };
    assert.deepEqual(mergeBasicConfig(iot, checked({ bands: ['band2g', 'band5g'], passphrase: PASS })), refusal);
    assert.deepEqual(mergeBasicConfig(iot, checked({ bands: ['band6g'], passphrase: PASS })), refusal);
    const iotOpen = openDetail(1, 3, { enhancedIotConnectivity: true });
    assert.deepEqual(mergeBasicConfig(iotOpen, checked({ bands: ['band2g', 'band5g'] })), refusal);
    // An open network's stale WPA3 setting would need versionPsk 4 on 2.4 GHz
    const staleWpa3 = openDetail(1, 3, { enhancedIotConnectivity: true, pskSetting: { versionPsk: 4, encryptionPsk: 3, gikRekeyPskEnable: false } });
    assert.deepEqual(mergeBasicConfig(staleWpa3, checked({ security: 'wpaPersonal', passphrase: PASS })), refusal);
    // No conflict without 5 / 6 GHz and versionPsk 4: the feature stays on
    const opened = merged(iot, { security: 'open' });
    assert.equal(opened.enhancedIotConnectivity, true);
    assert.deepEqual(consistencyProblems(opened), []);
  }); // End of test "Enhanced IoT Connectivity on..."

  test('deriveSecurityDependents(): a create (no fresh values) gets the table defaults; an edit keeps allowed fresh values', () => {
    assert.deepEqual(deriveSecurityDependents(3, 3), { ok: true, dependents: { versionPsk: 2, encryptionPsk: 3, pmfMode: 2 } });
    assert.deepEqual(deriveSecurityDependents(3, 4), { ok: true, dependents: { versionPsk: 4, encryptionPsk: 3, pmfMode: 1 } });
    assert.deepEqual(deriveSecurityDependents(0, 3), { ok: true, dependents: { pmfMode: 3 } });
    assert.deepEqual(deriveSecurityDependents(0, 5), { ok: false, error: 'securityBandConflict', diagnostic: 'conflict: oweEnable' });
    assert.deepEqual(deriveSecurityDependents(0, 5, {}), { ok: true, dependents: { pmfMode: 1, oweEnable: true } });
    assert.deepEqual(deriveSecurityDependents(3, 3, { versionPsk: 1, encryptionPsk: 1, pmfMode: 3 }), { ok: true, dependents: { versionPsk: 1, encryptionPsk: 1, pmfMode: 3 } });
    assert.deepEqual(deriveSecurityDependents(3, 3, { versionPsk: 9, encryptionPsk: 2, pmfMode: 1, oweEnable: true }), {
      ok: true,
      dependents: { versionPsk: 2, encryptionPsk: 3, pmfMode: 2, oweEnable: false }
    });
  }); // End of test "deriveSecurityDependents()..."

  test('every security / band transition from every reported combination yields a consistent body (exhaustive sweep)', () => {
    let transitions = 0;
    for (const freshSecurity of [0, 3]) {
      for (let freshBand = 1; freshBand <= 7; freshBand++) {
        for (const pmfMode of [1, 2, 3]) {
          for (const oweEnable of [true, false, undefined]) {
            for (const versionPsk of [1, 2, 3, 4]) {
              for (const encryptionPsk of [1, 3]) {
                const owe = oweEnable === undefined ? {} : { oweEnable };
                const detail = freshSecurity === 3
                  ? wpaDetail(freshBand, versionPsk, encryptionPsk, pmfMode, owe)
                  : openDetail(freshBand, pmfMode, { ...owe, pskSetting: { versionPsk, encryptionPsk, gikRekeyPskEnable: false } });
                for (const security of ['open', 'wpaPersonal'] as NetworkSecurity[]) {
                  for (let band = 1; band <= 7; band++) {
                    const result = security === 'open' ? 0 : 3;
                    if (result === freshSecurity && band === freshBand) {
                      continue;
                    }
                    const body = merged(detail, { security, bands: bandsOf(band), passphrase: result === 3 ? PASS : undefined });
                    assert.deepEqual(consistencyProblems(body), [], `${JSON.stringify(detail)} → ${security} ${band}`);
                    transitions++;
                  } // End of the loop over the resulting bands
                } // End of the loop over the resulting security modes
              } // End of the loop over the encryptions
            } // End of the loop over the WPA versions
          } // End of the loop over the OWE states
        } // End of the loop over the PMF modes
      } // End of the loop over the reported bands
    } // End of the loop over the reported security modes
    assert.ok(transitions > 10000, `${transitions} transitions checked`);
  }); // End of test "every security / band transition..."
}); // End of the describe block for security and bands

describe('checkNetworkEdits(): the edit rules that need no controller data', () => {
  test('nothing edited (an empty passphrase counts as not typed) → nothingToChange', () => {
    assert.deepEqual(checkNetworkEdits({}), { ok: false, error: 'nothingToChange' });
    assert.deepEqual(checkNetworkEdits({ passphrase: '' }), { ok: false, error: 'nothingToChange' });
  });

  test('the name, security, bands and passphrase rules answer with codes; valid edits come back checked', () => {
    assert.deepEqual(checkNetworkEdits({ name: ' ' }), { ok: false, error: 'nameRequired' });
    assert.deepEqual(checkNetworkEdits({ name: 'a'.repeat(33) }), { ok: false, error: 'nameTooLong' });
    assert.deepEqual(checkNetworkEdits({ security: 'wpaEnterprise' }), { ok: false, error: 'unsupportedSecurity' });
    assert.deepEqual(checkNetworkEdits({ security: 'ppskWithRadius' }), { ok: false, error: 'unsupportedSecurity' });
    assert.deepEqual(checkNetworkEdits({ security: 'unknown' }), { ok: false, error: 'unsupportedSecurity' });
    assert.deepEqual(checkNetworkEdits({ bands: [] }), { ok: false, error: 'bandsRequired' });
    assert.deepEqual(checkNetworkEdits({ passphrase: 'corta' }), { ok: false, error: 'passphraseInvalid' });
    assert.deepEqual(checkNetworkEdits({ name: ' Casa ', security: 'open', bands: ['band5g', 'band2g'], passphrase: '12345678' }), {
      ok: true,
      edits: { name: 'Casa', security: 0, bandMask: 3, passphrase: '12345678' }
    });
  }); // End of test "the name, security, bands and..."
}); // End of the describe block for the edit rules

describe('Small builders, the error table and the client sanity check', () => {
  test('buildEnableBody(): exactly {ssidEnable}', () => {
    assert.deepEqual(buildEnableBody(true), { ssidEnable: true });
    assert.deepEqual(buildEnableBody(false), fixtures.enable.body);
  });

  test('the documented errorCodes map per operation; enable / delete map none', () => {
    assert.equal(NETWORK_CONTROLLER_ERRORS.create.get(-33219), 'nameTaken');
    assert.equal(NETWORK_CONTROLLER_ERRORS.create.get(-33231), 'nameTaken');
    assert.equal(NETWORK_CONTROLLER_ERRORS.create.get(-33240), 'nameTooLong');
    assert.equal(NETWORK_CONTROLLER_ERRORS.create.get(-33217), 'unsupportedSecurity');
    assert.equal(NETWORK_CONTROLLER_ERRORS.create.get(-33238), undefined, 'not documented for create');
    assert.equal(NETWORK_CONTROLLER_ERRORS.update.get(-33238), 'bandLimitReached');
    assert.equal(NETWORK_CONTROLLER_ERRORS.password.get(-33219), 'nameTaken');
    assert.equal(NETWORK_CONTROLLER_ERRORS.update.get(-33807), undefined);
    assert.equal(NETWORK_CONTROLLER_ERRORS.update.get(-33000), undefined);
    assert.equal(NETWORK_CONTROLLER_ERRORS.enable.size, 0);
    assert.equal(NETWORK_CONTROLLER_ERRORS.delete.size, 0);
  }); // End of test "the documented errorCodes map per..."

  test('isSaneSsidWriteBody(): open without pskSetting, WPA-Personal with a valid key; never Enterprise / PPSK / garbage', () => {
    assert.equal(isSaneSsidWriteBody(fixtures.create.open.body), true);
    assert.equal(isSaneSsidWriteBody(fixtures.basicConfig.edit.body), true);
    assert.equal(isSaneSsidWriteBody(fixtures.basicConfig.toOpen.body), true);
    for (const security of [2, 4, 5, 1, '3']) {
      assert.equal(isSaneSsidWriteBody({ ...fixtures.basicConfig.edit.body, security }), false, String(security));
    }
    assert.equal(isSaneSsidWriteBody({ ...fixtures.create.open.body, pskSetting: { securityKey: '12345678' } }), false);
    assert.equal(isSaneSsidWriteBody({ ...fixtures.basicConfig.edit.body, pskSetting: { versionPsk: 2 } }), false);
    assert.equal(isSaneSsidWriteBody({ ...fixtures.basicConfig.edit.body, pskSetting: { securityKey: CURRENT_KEY.repeat(4) } }), false);
    assert.equal(isSaneSsidWriteBody({ ...fixtures.create.open.body, name: '' }), false);
    assert.equal(isSaneSsidWriteBody({ ...fixtures.create.open.body, band: 8 }), false);
    assert.equal(isSaneSsidWriteBody(null), false);
    assert.equal(isSaneSsidWriteBody([fixtures.create.open.body]), false);
    assert.deepEqual(ssidBodySecrets(fixtures.create.open.body), []);
    assert.deepEqual(ssidBodySecrets(fixtures.basicConfig.edit.body), ['fixture-new-passphrase-1']);
  }); // End of test "isSaneSsidWriteBody()..."

  test('the fixture group ids are the two groups the create bodies bind', () => {
    assert.deepEqual(fixtures.create.open.body.apGroupIds, [GROUP_A, GROUP_B]);
  });
}); // End of the describe block for small builders
