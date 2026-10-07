// Tests for the pure logic of the Wi-Fi network editing UI of the renderer
// (src/renderer/network-editing.ts, a DOM-free module; phase 18b): which
// write actions a network offers per security mode and management state
// (none while management is off or being re-checked; no Edit / Change
// password for Enterprise / PPSK / unknown; no Enable / Disable for an
// unknown state), the mirror of main's write rules checked against
// src/main/wifi-network-write.ts itself (the SSID's UTF-8 byte boundaries,
// the passphrase boundaries, never trimmed, the create form's order of
// checks), the staged edit (its changes, "nothing to change", the
// passphrase every WPA-Personal result needs, the review's rows and notes —
// the PMF note included), the reply validation, the es and en text of every
// error code (a securityBandConflict naming its field), the impact summary
// of the confirmations (scope, bound groups by name), and the freshness
// rules no write may bypass (never on internal data stale after a failed
// refresh, nor on a managed list stale or being read; a network that
// changed since it was captured is "changed").

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  checkNetworkCreate,
  checkNetworkEdits,
  MAX_PASSPHRASE_LENGTH as MAIN_MAX_PASSPHRASE_LENGTH,
  MAX_SSID_NAME_BYTES as MAIN_MAX_SSID_NAME_BYTES,
  MIN_PASSPHRASE_LENGTH as MAIN_MIN_PASSPHRASE_LENGTH,
  utf8ByteLength as mainUtf8ByteLength,
  validatePassphrase,
  validateSsidName,
} from '../../src/main/wifi-network-write';
import type { AccessPoint, Language, ManagedNetwork, NetworkBand, NetworkOperationError, NetworkSecurity, WlanGroup } from '../../src/shared/types';
import { formatMessage, translations } from '../../src/renderer/i18n-strings';
import {
  bandListText,
  canonicalBands,
  checkCreateDraft,
  checkEditDraft,
  checkNetworkName,
  checkPassphrase,
  conflictFieldOf,
  editNoteTexts,
  editReviewRows,
  findCreatedNetworkId,
  impactNote,
  impactRows,
  passwordReviewSummary,
  initialEditDraft,
  isEditableSecurity,
  isNetworkOperationError,
  isNetworkStaleDataFailure,
  MAX_PASSPHRASE_LENGTH,
  MAX_SSID_NAME_BYTES,
  MIN_PASSPHRASE_LENGTH,
  networkActions,
  networkErrorKey,
  networkFailureText,
  networkWriteBlock,
  notEditableText,
  parseNetworkActionResult,
  planNetworkEdit,
  sameManagedNetwork,
  scopeSummaryText,
  utf8ByteLength,
  type CreateDraft,
  type EditDraft,
  type NetworkFreshness,
  type NetworkWriteFailure,
  type TextContext,
} from '../../src/renderer/network-editing';
import { managedNetworkScope, networkManagementOn, summarizeScope, type NetworkManagementInput } from '../../src/renderer/network-management';

// Every NetworkOperationError main can answer with (src/shared/types.ts)
const ERRORS: NetworkOperationError[] = [
  'notConnected',
  'superseded',
  'managementUnavailable',
  'nameRequired',
  'nameTooLong',
  'nameInvalid',
  'nameTaken',
  'passphraseRequired',
  'passphraseInvalid',
  'passphraseNotApplicable',
  'bandsRequired',
  'groupsRequired',
  'unsupportedSecurity',
  'nothingToChange',
  'bandLimitReached',
  'securityBandConflict',
  'groupNotFound',
  'groupListIncomplete',
  'networkStateUnknown',
  'requestFailed',
];

// The renderer's own failures (never one of main's codes)
const RENDERER_FAILURES: NetworkWriteFailure[] = ['passphraseMismatch', 'dataStale', 'listStale', 'dataReading', 'networkChanged', 'failed'];

// Every failure the renderer shows: main's codes and its own
const FAILURES: NetworkWriteFailure[] = [...ERRORS, ...RENDERER_FAILURES];

// Three AP groups with 24-hex ids, and one more the group list lacks
const G1 = '6512a0e1f3b2c41d2e3f4a5b';
const G2 = '6512a0e1f3b2c41d2e3f4a5c';
const G3 = '6512a0e1f3b2c41d2e3f4a5d';
const G_UNLISTED = '6512a0e1f3b2c41d2e3f4aff';

// A passphrase that must never appear in any value the module returns
const SENTINEL = 'SENTINEL-pass-18b';

/**
 * The text context of a language (the translator over its table).
 * @param {Language} language - The language.
 * @returns {TextContext} The context.
 */
function ctx(language: Language): TextContext {
  return { tr: (key, vars) => formatMessage(translations[language][key], vars ?? {}), language };
}

/**
 * Builds a group for the tests.
 * @param {string} wlanId - Group id.
 * @param {string} wlanName - Group name.
 * @returns {WlanGroup} The group.
 */
function group(wlanId: string, wlanName: string): WlanGroup {
  return { wlanId, wlanName, ssidList: [] };
}

/**
 * Builds an AP for the tests.
 * @param {number} n - Its number (for a unique MAC).
 * @param {string} wlanGroup - The name of its group ('' = none).
 * @returns {AccessPoint} The AP.
 */
function ap(n: number, wlanGroup: string): AccessPoint {
  return { mac: `AA-BB-CC-00-11-${n.toString(16).padStart(2, '0').toUpperCase()}`, name: `AP ${n}`, type: 'ap', wlanGroup, statusCategory: 1 };
}

/**
 * Builds a valid managed network (WPA-Personal, 2.4 + 5 GHz, enabled, bound
 * to G1), with the given fields overridden.
 * @param {Partial<ManagedNetwork>} [overrides] - Fields to set.
 * @returns {ManagedNetwork} The network.
 */
function network(overrides: Partial<ManagedNetwork> = {}): ManagedNetwork {
  return {
    id: '5f00c0ffee0000000000c0a1',
    name: 'Casa',
    security: 'wpaPersonal',
    bands: ['band2g', 'band5g'],
    enabled: true,
    hasPassphrase: true,
    scope: 'apGroups',
    apGroupIds: [G1],
    ...overrides,
  };
}

/**
 * The management input of a connected 6.3 session with every check passed.
 * @param {Partial<NetworkManagementInput>} [overrides] - Fields to set.
 * @returns {NetworkManagementInput} The input.
 */
function managementInput(overrides: Partial<NetworkManagementInput> = {}): NetworkManagementInput {
  return {
    isConnected: true,
    hasSessionNonce: true,
    hasData: true,
    groupModel: 'apGroup',
    capabilities: { manageApGroups: true, manageWifiNetworks: true, reason: null },
    ...overrides,
  };
}

/**
 * A create form's values (WPA-Personal, 2.4 + 5 GHz, bound to G1).
 * @param {Partial<CreateDraft>} [overrides] - Fields to set.
 * @returns {CreateDraft} The draft.
 */
function createDraft(overrides: Partial<CreateDraft> = {}): CreateDraft {
  return { name: 'Nueva', security: 'wpaPersonal', bands: ['band2g', 'band5g'], apGroupIds: [G1], ...overrides };
}

describe('mirror of the main-side constants', () => {
  test('the SSID byte limit and the passphrase bounds equal src/main/wifi-network-write.ts', () => {
    assert.equal(MAX_SSID_NAME_BYTES, MAIN_MAX_SSID_NAME_BYTES);
    assert.equal(MIN_PASSPHRASE_LENGTH, MAIN_MIN_PASSPHRASE_LENGTH);
    assert.equal(MAX_PASSPHRASE_LENGTH, MAIN_MAX_PASSPHRASE_LENGTH);
  });
});

describe('networkActions()', () => {
  test('nothing at all while Wi-Fi network management is off — also while a capability check runs, on a legacy controller and with any read-only reason', () => {
    const inputs: NetworkManagementInput[] = [
      managementInput({ capabilities: null }),
      managementInput({ groupModel: 'wlanGroup' }),
      managementInput({ capabilities: { manageApGroups: false, manageWifiNetworks: false, reason: 'siteNotFound' } }),
      managementInput({ capabilities: { manageApGroups: true, manageWifiNetworks: false, reason: null } }),
      managementInput({ hasSessionNonce: false }),
      managementInput({ isConnected: false }),
    ];
    for (const input of inputs) {
      assert.equal(networkActions(network(), networkManagementOn(input)), null, JSON.stringify(input));
    }
    assert.notEqual(networkActions(network(), networkManagementOn(managementInput())), null);
  });

  test('Open and WPA-Personal are editable; Change password only for WPA-Personal; the toggle follows the enabled state; Delete always', () => {
    assert.deepEqual(networkActions(network({ security: 'open', enabled: true }), true), { edit: true, changePassword: false, toggle: 'disable', delete: true, notEditable: null });
    assert.deepEqual(networkActions(network({ security: 'wpaPersonal', enabled: false }), true), { edit: true, changePassword: true, toggle: 'enable', delete: true, notEditable: null });
  });

  test('Enterprise, PPSK and unknown security: no Edit / Change password, the reason stated; Enable / Disable and Delete stay (spec §4.5)', () => {
    const cases: Array<[NetworkSecurity, string]> = [
      ['wpaEnterprise', 'enterprise'],
      ['ppskWithoutRadius', 'ppsk'],
      ['ppskWithRadius', 'ppsk'],
      ['unknown', 'unknown'],
    ];
    for (const [security, reason] of cases) {
      const actions = networkActions(network({ security, enabled: false }), true);
      assert.deepEqual(actions, { edit: false, changePassword: false, toggle: 'enable', delete: true, notEditable: reason }, security);
    }
  });

  test('an unknown enabled state hides Enable / Disable (spec §5)', () => {
    for (const security of ['open', 'wpaPersonal', 'wpaEnterprise', 'unknown'] as const) {
      assert.equal(networkActions(network({ security, enabled: null }), true)?.toggle, null, security);
    }
  });

  test('isEditableSecurity() is true for open and wpaPersonal only', () => {
    const all: NetworkSecurity[] = ['open', 'wpaEnterprise', 'wpaPersonal', 'ppskWithoutRadius', 'ppskWithRadius', 'unknown'];
    assert.deepEqual(all.filter(isEditableSecurity), ['open', 'wpaPersonal']);
  });

  test('the not-editable explanation names the security mode (es / en), or states it as unclear', () => {
    assert.equal(
      notEditableText(network({ security: 'wpaEnterprise' }), ctx('es')),
      'La aplicación solo edita redes abiertas y WPA-Personal, así que aquí no se pueden cambiar los ajustes ni la contraseña de esta red WPA-Enterprise: hazlo en el controlador. Sí se puede activar, desactivar o eliminar.'
    );
    assert.match(notEditableText(network({ security: 'ppskWithRadius' }), ctx('en')), /this PPSK with RADIUS network/);
    assert.match(notEditableText(network({ security: 'ppskWithoutRadius' }), ctx('es')), /esta red PPSK sin RADIUS/);
    assert.equal(notEditableText(network({ security: 'unknown' }), ctx('en')), translations.en.networkNotEditableUnknown);
  });
});

describe('freshness of the data a write acts on', () => {
  /**
   * The freshness of a session whose data and managed list are fresh.
   * @param {Partial<NetworkFreshness>} [overrides] - Fields to set.
   * @returns {NetworkFreshness} The input.
   */
  function fresh(overrides: Partial<NetworkFreshness> = {}): NetworkFreshness {
    return { refreshError: false, listStatus: 'ready', hasList: true, ...overrides };
  }

  test('writes go ahead only with fresh internal data and a managed list read successfully (not being read)', () => {
    assert.equal(networkWriteBlock(fresh()), null);
  });

  test('internal data stale after a failed refresh holds back every write — whatever the managed list', () => {
    for (const listStatus of ['ready', 'loading', 'failed', 'idle'] as const) {
      assert.equal(networkWriteBlock(fresh({ refreshError: true, listStatus })), 'dataStale', listStatus);
    }
  });

  test('a managed list whose latest read failed holds back every write: a stale list kept on screen, or none (failed first read)', () => {
    assert.equal(networkWriteBlock(fresh({ listStatus: 'failed' })), 'listStale');
    assert.equal(networkWriteBlock(fresh({ listStatus: 'failed', hasList: false })), 'listStale');
  });

  test('a managed list being read (a re-read keeping the old list on screen, or a first read) or not read yet holds back every write', () => {
    assert.equal(networkWriteBlock(fresh({ listStatus: 'loading' })), 'dataReading');
    assert.equal(networkWriteBlock(fresh({ listStatus: 'loading', hasList: false })), 'dataReading');
    assert.equal(networkWriteBlock(fresh({ listStatus: 'idle', hasList: false })), 'dataReading');
    assert.equal(networkWriteBlock(fresh({ hasList: false })), 'dataReading');
  });

  test('sameManagedNetwork(): every DTO field must match (bands and bound groups as sets)', () => {
    const base = network({ apGroupIds: [G1, G2] });
    assert.equal(sameManagedNetwork(base, network({ apGroupIds: [G1, G2] })), true);
    assert.equal(sameManagedNetwork(base, network({ apGroupIds: [G2, G1], bands: ['band5g', 'band2g'] })), true);
    const changes: Partial<ManagedNetwork>[] = [
      { id: '5f00c0ffee0000000000c0a2' },
      { name: 'Casa 2' },
      { security: 'open' },
      { enabled: false },
      { enabled: null },
      { hasPassphrase: false },
      { scope: 'allAccessPoints' },
      { bands: ['band2g'] },
      { bands: null },
      { apGroupIds: [G1] },
      { apGroupIds: [G1, G2, G3] },
      { apGroupIds: [G1, G3] },
      { apGroupIds: null },
    ];
    for (const change of changes) {
      assert.equal(sameManagedNetwork(base, network({ apGroupIds: [G1, G2], ...change })), false, JSON.stringify(change));
    }
    assert.equal(sameManagedNetwork(network({ bands: null, apGroupIds: null }), network({ bands: null, apGroupIds: null })), true);
  });

  test('the freshness refusals have their own es and en text (the detail\'s note and the refusal): stale data, stale list, a read running, a changed network', () => {
    assert.equal(networkFailureText({ error: 'dataStale', diagnostic: null }, ctx('es')),
      'Los datos en pantalla no están al día (falló su última actualización): no se puede cambiar ninguna red Wi-Fi hasta que se actualicen.');
    assert.equal(networkFailureText({ error: 'dataStale', diagnostic: null }, ctx('en')),
      'The data on screen is not up to date (its last refresh failed): no Wi-Fi network can be changed until it is refreshed.');
    assert.equal(networkFailureText({ error: 'listStale', diagnostic: null }, ctx('es')),
      'La lista de redes Wi-Fi no está al día (falló su última lectura): no se puede cambiar ninguna red hasta que se vuelva a leer (Reintentar).');
    assert.equal(networkFailureText({ error: 'listStale', diagnostic: null }, ctx('en')),
      'The Wi-Fi network list is not up to date (its last read failed): no network can be changed until it is read again (Retry).');
    assert.equal(networkFailureText({ error: 'dataReading', diagnostic: null }, ctx('es')), 'Se están leyendo de nuevo las redes Wi-Fi: espera a que termine para cambiar una red.');
    assert.equal(networkFailureText({ error: 'dataReading', diagnostic: null }, ctx('en')), 'The Wi-Fi networks are being read again: wait for it to finish to change a network.');
    assert.match(networkFailureText({ error: 'networkChanged', diagnostic: null }, ctx('es')), /^La red ha cambiado en el controlador \(o ya no está\).*No se envió nada\.$/);
    assert.match(networkFailureText({ error: 'networkChanged', diagnostic: null }, ctx('en')), /^The network changed on the controller \(or is gone\).*Nothing was sent\.$/);
  });
});

describe('the SSID name rule (mirror of validateSsidName())', () => {
  const samples = [
    '',
    '   ',
    'a',
    '  Casa  ',
    'a'.repeat(32),
    'a'.repeat(33),
    'ñ'.repeat(16),
    'ñ'.repeat(16) + 'a',
    '€'.repeat(10) + 'ab',
    '€'.repeat(11),
    '😀'.repeat(8),
    '😀'.repeat(8) + 'a',
    '  ' + 'a'.repeat(32) + '  ',
    'Casa\u0007',
    'Casa‮',
    'Casa ',
    'Ca‏sa',
    'Café ☕',
  ];

  test('counts UTF-8 bytes like main and like Buffer.byteLength', () => {
    for (const sample of samples) {
      assert.equal(utf8ByteLength(sample), mainUtf8ByteLength(sample), sample);
      assert.equal(utf8ByteLength(sample), Buffer.byteLength(sample, 'utf8'), sample);
    }
  });

  test('gives exactly main\'s verdict for every sample (1- to 4-byte boundaries, trimming, control and bidi characters)', () => {
    for (const sample of samples) {
      assert.deepEqual(checkNetworkName(sample), validateSsidName(sample), JSON.stringify(sample));
    }
  });

  test('the byte boundaries: 32 bytes pass, 33 do not — whatever the characters\' widths', () => {
    assert.deepEqual(checkNetworkName('ñ'.repeat(16)), { ok: true, name: 'ñ'.repeat(16) });
    assert.deepEqual(checkNetworkName('ñ'.repeat(16) + 'a'), { ok: false, error: 'nameTooLong' });
    assert.deepEqual(checkNetworkName('😀'.repeat(8)), { ok: true, name: '😀'.repeat(8) });
    assert.deepEqual(checkNetworkName('😀'.repeat(8) + 'a'), { ok: false, error: 'nameTooLong' });
    assert.deepEqual(checkNetworkName('  Casa  '), { ok: true, name: 'Casa' });
    assert.deepEqual(checkNetworkName(' \t '), { ok: false, error: 'nameRequired' });
  });
});

describe('the passphrase rule (mirror of validatePassphrase(), plus the confirmation)', () => {
  test('8 to 63 printable ASCII characters: 7 and 64 are refused, 8 and 63 accepted', () => {
    for (const [length, ok] of [[7, false], [8, true], [63, true], [64, false]] as const) {
      const value = 'p'.repeat(length);
      assert.equal(checkPassphrase(value, value), ok ? null : 'passphraseInvalid', String(length));
      assert.equal(validatePassphrase(value).ok, ok, `main ${length}`);
    }
  });

  test('never trimmed: spaces around count and are kept; a 64-hex raw key and non-ASCII are refused like main', () => {
    const samples = ['  abcdef', 'abcdef  ', '        ', ' a b c d ', 'contraseña1', 'tab\tpassword', 'a'.repeat(64).replace(/a/g, 'f'), '~!@#$%^&*()_+{}|:"<>?'];
    for (const sample of samples) {
      assert.equal(checkPassphrase(sample, sample) === null, validatePassphrase(sample).ok, JSON.stringify(sample));
    }
    assert.equal(checkPassphrase('  abcdef', '  abcdef'), null);
    assert.equal(checkPassphrase('  abcdef', 'abcdef'), 'passphraseMismatch');
  });

  test('empty is "not typed" (required); a confirmation that differs is refused last', () => {
    assert.equal(checkPassphrase('', ''), 'passphraseRequired');
    assert.equal(checkPassphrase('', 'something'), 'passphraseRequired');
    assert.equal(checkPassphrase('short', 'other'), 'passphraseInvalid');
    assert.equal(checkPassphrase('long enough', 'long enougH'), 'passphraseMismatch');
  });
});

describe('checkCreateDraft()', () => {
  test('a valid WPA-Personal create: the trimmed name, canonical bands, deduplicated groups', () => {
    const check = checkCreateDraft(createDraft({ name: '  Nueva  ', bands: ['band5g', 'band2g', 'band5g'], apGroupIds: [G2, G1, G2] }), SENTINEL, SENTINEL);
    assert.deepEqual(check, { ok: true, create: { name: 'Nueva', security: 'wpaPersonal', bands: ['band2g', 'band5g'], apGroupIds: [G2, G1] } });
    assert.ok(!JSON.stringify(check).includes(SENTINEL));
  });

  test('an open create ignores the (hidden) passphrase fields', () => {
    assert.equal(checkCreateDraft(createDraft({ security: 'open' }), '', '').ok, true);
  });

  test('refusals in main\'s order: name, bands, open + 6 GHz (naming oweEnable), groups, then the passphrase', () => {
    assert.deepEqual(checkCreateDraft(createDraft({ name: ' ', bands: [], apGroupIds: [] }), '', ''), { ok: false, error: 'nameRequired', diagnostic: null });
    assert.deepEqual(checkCreateDraft(createDraft({ bands: [], apGroupIds: [] }), '', ''), { ok: false, error: 'bandsRequired', diagnostic: null });
    assert.deepEqual(checkCreateDraft(createDraft({ security: 'open', bands: ['band2g', 'band6g'], apGroupIds: [] }), '', ''), {
      ok: false, error: 'securityBandConflict', diagnostic: null, conflictField: 'oweEnable',
    });
    assert.deepEqual(checkCreateDraft(createDraft({ apGroupIds: [] }), '', ''), { ok: false, error: 'groupsRequired', diagnostic: null });
    assert.deepEqual(checkCreateDraft(createDraft({ apGroupIds: ['bad id!'] }), '', ''), { ok: false, error: 'groupNotFound', diagnostic: null });
    assert.deepEqual(checkCreateDraft(createDraft(), '', ''), { ok: false, error: 'passphraseRequired', diagnostic: null });
    assert.deepEqual(checkCreateDraft(createDraft(), 'short', 'short'), { ok: false, error: 'passphraseInvalid', diagnostic: null });
    assert.deepEqual(checkCreateDraft(createDraft(), SENTINEL, 'other'), { ok: false, error: 'passphraseMismatch', diagnostic: null });
  });

  test('agrees with main\'s checkNetworkCreate() on every draft (the request the renderer would send)', () => {
    const drafts: CreateDraft[] = [
      createDraft(),
      createDraft({ name: '' }),
      createDraft({ name: 'x'.repeat(33) }),
      createDraft({ name: 'Bad\u0000name' }),
      createDraft({ bands: [] }),
      createDraft({ security: 'open', bands: ['band6g'] }),
      createDraft({ security: 'open', bands: ['band2g', 'band5g'] }),
      createDraft({ security: 'wpaPersonal', bands: ['band6g'] }),
      createDraft({ apGroupIds: [] }),
      createDraft({ apGroupIds: [G1, G1, G3] }),
    ];
    for (const passphrase of ['', 'short', SENTINEL]) {
      for (const draft of drafts) {
        const renderer = checkCreateDraft(draft, passphrase, passphrase);
        const main = checkNetworkCreate({ ...draft, passphrase: draft.security === 'wpaPersonal' && passphrase !== '' ? passphrase : undefined });
        assert.equal(renderer.ok, main.ok, `${JSON.stringify(draft)} / ${passphrase}`);
        if (!renderer.ok && !main.ok) {
          assert.equal(renderer.error, main.error, JSON.stringify(draft));
        }
      }
    }
  });
});

describe('the staged edit', () => {
  test('initialEditDraft(): the network\'s name, security and bands (none ticked when unknown)', () => {
    assert.deepEqual(initialEditDraft(network()), { name: 'Casa', security: 'wpaPersonal', bands: ['band2g', 'band5g'] });
    assert.deepEqual(initialEditDraft(network({ security: 'open', bands: null })), { name: 'Casa', security: 'open', bands: [] });
  });

  test('no change is "nothing to change" — also with a re-typed passphrase, and with spaces around the same name', () => {
    const draft = initialEditDraft(network());
    assert.deepEqual(checkEditDraft(network(), draft, SENTINEL, SENTINEL), { ok: false, error: 'nothingToChange', diagnostic: null });
    assert.deepEqual(checkEditDraft(network(), { ...draft, name: '  Casa ' }, SENTINEL, SENTINEL), { ok: false, error: 'nothingToChange', diagnostic: null });
    assert.deepEqual(checkEditDraft(network({ bands: null }), initialEditDraft(network({ bands: null })), SENTINEL, SENTINEL).ok, false);
  });

  test('a network the app does not edit is refused before anything else', () => {
    for (const security of ['wpaEnterprise', 'ppskWithRadius', 'unknown'] as const) {
      assert.deepEqual(checkEditDraft(network({ security }), { name: 'Otra', security: 'open', bands: ['band2g'] }, '', ''), { ok: false, error: 'unsupportedSecurity', diagnostic: null });
    }
  });

  test('every save whose result is WPA-Personal needs the re-typed passphrase — a rename too; an open result never', () => {
    const rename: EditDraft = { name: 'Casa 2', security: 'wpaPersonal', bands: ['band2g', 'band5g'] };
    assert.equal(planNetworkEdit(network(), rename).needsPassphrase, true);
    assert.deepEqual(checkEditDraft(network(), rename, '', ''), { ok: false, error: 'passphraseRequired', diagnostic: null });
    assert.deepEqual(checkEditDraft(network(), rename, SENTINEL, 'x'), { ok: false, error: 'passphraseMismatch', diagnostic: null });
    assert.equal(checkEditDraft(network(), rename, SENTINEL, SENTINEL).ok, true);
    const toOpen: EditDraft = { name: 'Casa', security: 'open', bands: ['band2g', 'band5g'] };
    assert.equal(planNetworkEdit(network(), toOpen).needsPassphrase, false);
    assert.equal(checkEditDraft(network(), toOpen, '', '').ok, true);
    const openRename: EditDraft = { name: 'Abierta 2', security: 'open', bands: ['band2g'] };
    assert.equal(checkEditDraft(network({ security: 'open', bands: ['band2g'] }), openRename, '', '').ok, true);
  });

  test('the plan lists the changes and sends only the edited fields (the name trimmed)', () => {
    const plan = planNetworkEdit(network(), { name: '  Casa Nueva ', security: 'wpaPersonal', bands: ['band5g', 'band2g', 'band6g'] });
    assert.deepEqual(plan.changes, [
      { field: 'name', from: 'Casa', to: 'Casa Nueva' },
      { field: 'bands', from: ['band2g', 'band5g'], to: ['band2g', 'band5g', 'band6g'] },
    ]);
    assert.deepEqual(plan.edits, { name: 'Casa Nueva', bands: ['band2g', 'band5g', 'band6g'] });
    assert.equal(plan.resultSecurity, 'wpaPersonal');
    assert.deepEqual(plan.notes, ['rename', 'pmf']);
  });

  test('the notes: switching to Open / WPA-Personal, bands removed, and the PMF note whenever security or bands change on a WPA-Personal result but 6 GHz alone', () => {
    assert.deepEqual(planNetworkEdit(network(), { name: 'Casa', security: 'open', bands: ['band2g', 'band5g'] }).notes, ['toOpen']);
    assert.deepEqual(planNetworkEdit(network({ security: 'open' }), { name: 'Casa', security: 'wpaPersonal', bands: ['band2g', 'band5g'] }).notes, ['toWpaPersonal', 'pmf']);
    assert.deepEqual(planNetworkEdit(network(), { name: 'Casa', security: 'wpaPersonal', bands: ['band2g'] }).notes, ['bandsRemoved', 'pmf']);
    assert.deepEqual(planNetworkEdit(network(), { name: 'Casa', security: 'wpaPersonal', bands: ['band6g'] }).notes, ['bandsRemoved']);
    assert.deepEqual(planNetworkEdit(network({ security: 'open' }), { name: 'Casa', security: 'open', bands: ['band2g', 'band5g', 'band6g'] }).notes, []);
    assert.deepEqual(planNetworkEdit(network(), { name: 'Otra', security: 'wpaPersonal', bands: ['band2g', 'band5g'] }).notes, ['rename']);
  });

  test('bands the controller did not report: none ticked keeps them; ticking sets them (from "unknown"); unticking known bands is "bands required"', () => {
    const unknownBands = network({ bands: null });
    assert.equal(planNetworkEdit(unknownBands, { name: 'Casa 2', security: 'wpaPersonal', bands: [] }).edits.bands, undefined);
    assert.deepEqual(planNetworkEdit(unknownBands, { name: 'Casa', security: 'wpaPersonal', bands: ['band5g'] }).changes, [{ field: 'bands', from: null, to: ['band5g'] }]);
    assert.deepEqual(checkEditDraft(network(), { name: 'Casa', security: 'wpaPersonal', bands: [] }, SENTINEL, SENTINEL), { ok: false, error: 'bandsRequired', diagnostic: null });
  });

  test('a new name is checked like main\'s (bytes, characters)', () => {
    assert.deepEqual(checkEditDraft(network({ security: 'open' }), { name: 'ñ'.repeat(17), security: 'open', bands: ['band2g', 'band5g'] }, '', ''), { ok: false, error: 'nameTooLong', diagnostic: null });
    assert.deepEqual(checkEditDraft(network({ security: 'open' }), { name: '   ', security: 'open', bands: ['band2g', 'band5g'] }, '', ''), { ok: false, error: 'nameRequired', diagnostic: null });
  });

  test('the edits the renderer sends pass main\'s checkNetworkEdits() (never "nothing to change")', () => {
    const drafts: EditDraft[] = [
      { name: 'Casa 2', security: 'wpaPersonal', bands: ['band2g', 'band5g'] },
      { name: 'Casa', security: 'open', bands: ['band2g', 'band5g'] },
      { name: 'Casa', security: 'wpaPersonal', bands: ['band6g'] },
    ];
    for (const draft of drafts) {
      const check = checkEditDraft(network(), draft, SENTINEL, SENTINEL);
      assert.equal(check.ok, true);
      if (check.ok) {
        const main = checkNetworkEdits({ ...check.plan.edits, passphrase: check.plan.needsPassphrase ? SENTINEL : undefined });
        assert.equal(main.ok, true, JSON.stringify(draft));
      }
    }
  });

  test('the review rows "before → after" in es and en, a password row that never shows it, and the notes\' texts', () => {
    const check = checkEditDraft(network(), { name: 'Casa 2', security: 'wpaPersonal', bands: ['band2g', 'band5g', 'band6g'] }, SENTINEL, SENTINEL);
    assert.equal(check.ok, true);
    if (!check.ok) return;
    assert.deepEqual(editReviewRows(check.plan, ctx('es')), [
      { kind: 'name', label: 'Nombre', value: 'Casa → Casa 2' },
      { kind: 'bands', label: 'Bandas', value: '2,4 GHz y 5 GHz → 2,4 GHz, 5 GHz y 6 GHz' },
      { kind: 'passphrase', label: 'Contraseña', value: 'La que has escrito (no se muestra)' },
    ]);
    assert.deepEqual(editReviewRows(check.plan, ctx('en')), [
      { kind: 'name', label: 'Name', value: 'Casa → Casa 2' },
      { kind: 'bands', label: 'Bands', value: '2.4 GHz and 5 GHz → 2.4 GHz, 5 GHz, and 6 GHz' },
      { kind: 'passphrase', label: 'Password', value: 'The one you typed (not shown)' },
    ]);
    assert.deepEqual(editNoteTexts(check.plan, ctx('en')), [translations.en.networkNoteRename, translations.en.networkNotePmf]);
    assert.match(translations.es.networkNotePmf, /"Obligatoria".*"Compatible"/);
    assert.match(translations.en.networkNotePmf, /"Mandatory".*"Capable"/);
    assert.ok(!JSON.stringify([check.plan, editReviewRows(check.plan, ctx('es'))]).includes(SENTINEL));

    const toOpen = planNetworkEdit(network(), { name: 'Casa', security: 'open', bands: ['band2g', 'band5g'] });
    assert.deepEqual(editReviewRows(toOpen, ctx('es')), [{ kind: 'security', label: 'Seguridad', value: 'WPA-Personal → Abierta' }]);
    const fromUnknown = planNetworkEdit(network({ bands: null }), { name: 'Casa', security: 'wpaPersonal', bands: ['band5g'] });
    assert.equal(editReviewRows(fromUnknown, ctx('en'))[0].value, 'Unknown → 5 GHz');
  });

  test('canonicalBands() and bandListText()', () => {
    const bands: NetworkBand[] = ['band6g', 'band2g', 'band6g'];
    assert.deepEqual(canonicalBands(bands), ['band2g', 'band6g']);
    assert.equal(bandListText(null, ctx('es')), 'Se desconoce');
    assert.equal(bandListText(['band6g', 'band2g'], ctx('es')), '2,4 GHz y 6 GHz');
  });
});

describe('failures', () => {
  test('every NetworkOperationError and the renderer\'s own failures have their own message key, with a text in es and en', () => {
    const keys = FAILURES.map(networkErrorKey);
    assert.equal(new Set(keys).size, FAILURES.length);
    for (const language of ['es', 'en'] as const) {
      const texts = keys.map(key => translations[language][key]);
      assert.ok(texts.every(text => typeof text === 'string' && text.trim().length > 10), language);
      assert.equal(new Set(texts).size, texts.length, `${language}: distinct texts`);
    }
    for (const key of keys) {
      assert.notEqual(translations.es[key], translations.en[key], key);
    }
  });

  test('isNetworkOperationError() knows main\'s codes only', () => {
    for (const code of ERRORS) {
      assert.equal(isNetworkOperationError(code), true, code);
    }
    for (const other of [...RENDERER_FAILURES, 'toString', '__proto__', 'NameTaken', '', 42, null, undefined]) {
      assert.equal(isNetworkOperationError(other), false, String(other));
    }
    // A reply naming one of the renderer's own codes is unreadable ('failed')
    for (const own of RENDERER_FAILURES) {
      assert.deepEqual(parseNetworkActionResult({ success: false, error: own }), { ok: false, error: 'failed', diagnostic: null }, own);
    }
  });

  test('networkFailureText(): the message, then main\'s codes-only diagnostic in parentheses', () => {
    assert.equal(
      networkFailureText({ error: 'nameTaken', diagnostic: 'ssid basic-config: apiError, errorCode -33219' }, ctx('es')),
      'El controlador ya tiene una red con este nombre (o es el nombre de la red de emergencia). (ssid basic-config: apiError, errorCode -33219)'
    );
    assert.equal(networkFailureText({ error: 'passphraseRequired', diagnostic: null }, ctx('en')), 'Type the network password.');
    assert.equal(networkFailureText({ error: 'networkStateUnknown', diagnostic: null }, ctx('en')), translations.en.networkErrorNetworkStateUnknown);
    assert.equal(networkFailureText({ error: 'managementUnavailable', diagnostic: null }, ctx('es')), translations.es.networkErrorManagementUnavailable);
    assert.equal(networkFailureText({ error: 'superseded', diagnostic: null }, ctx('en')), translations.en.networkErrorSuperseded);
  });

  test('a securityBandConflict names its field from main\'s "conflict: <field>" (or the client-side field); another field gets the generic text', () => {
    const iot = { error: 'securityBandConflict' as const, diagnostic: 'conflict: enhancedIotConnectivity' };
    assert.equal(conflictFieldOf(iot), 'enhancedIotConnectivity');
    assert.equal(networkFailureText(iot, ctx('en')), `${translations.en.networkConflictIot} (conflict: enhancedIotConnectivity)`);
    assert.match(networkFailureText(iot, ctx('en')), /Enhanced IoT Connectivity/);
    assert.match(networkFailureText(iot, ctx('es')), /conectividad IoT mejorada/);
    const owe = { error: 'securityBandConflict' as const, diagnostic: 'conflict: oweEnable' };
    assert.equal(networkFailureText(owe, ctx('es')), `${translations.es.networkConflictOwe} (conflict: oweEnable)`);
    assert.match(networkFailureText(owe, ctx('en')), /OWE \(Enhanced Open\)/);
    const local = { error: 'securityBandConflict' as const, diagnostic: null, conflictField: 'oweEnable' };
    assert.equal(networkFailureText(local, ctx('en')), translations.en.networkConflictOwe);
    const other = { error: 'securityBandConflict' as const, diagnostic: 'conflict: mloEnable' };
    assert.equal(networkFailureText(other, ctx('en')), `${translations.en.networkErrorSecurityBandConflict} (conflict: mloEnable)`);
    assert.equal(conflictFieldOf({ error: 'securityBandConflict', diagnostic: 'apiError' }), null);
  });

  test('parseNetworkActionResult(): success (a usable network id kept), main\'s known codes with a well-formed diagnostic, anything else "failed"; nothing else is kept', () => {
    assert.deepEqual(parseNetworkActionResult({ success: true, networkId: '5f00c0ffee0000000000c0a9' }), { ok: true, networkId: '5f00c0ffee0000000000c0a9' });
    assert.deepEqual(parseNetworkActionResult({ success: true, networkId: 'bad id!' }), { ok: true, networkId: null });
    assert.deepEqual(parseNetworkActionResult({ success: true, passphrase: SENTINEL }), { ok: true, networkId: null });
    assert.deepEqual(parseNetworkActionResult({ success: false, error: 'nameTaken', diagnostic: 'ssid create: apiError, errorCode -33219' }), {
      ok: false, error: 'nameTaken', diagnostic: 'ssid create: apiError, errorCode -33219',
    });
    assert.deepEqual(parseNetworkActionResult({ success: false, error: 'nameTaken', diagnostic: `<b>${SENTINEL}</b>` }), { ok: false, error: 'nameTaken', diagnostic: null });
    assert.deepEqual(parseNetworkActionResult({ success: false, error: 'mystery' }), { ok: false, error: 'failed', diagnostic: null });
    for (const raw of [null, undefined, 'x', 42, [], [{ success: true }]]) {
      assert.deepEqual(parseNetworkActionResult(raw), { ok: false, error: 'failed', diagnostic: null }, JSON.stringify(raw));
    }
  });

  test('isNetworkStaleDataFailure(): the refusals fresh controller data may cause', () => {
    assert.deepEqual(FAILURES.filter(isNetworkStaleDataFailure), ['nameTaken', 'unsupportedSecurity', 'groupNotFound', 'requestFailed']);
  });
});

describe('impact summary and scope text', () => {
  const groups = [group(G1, 'Default'), group(G2, 'zGrupo B'), group(G3, 'Exterior')];
  const aps = [ap(1, 'Default'), ap(2, 'Default'), ap(3, 'zGrupo B'), ap(4, 'Exterior')];

  test('"All access points": the scope and the note that later APs are included', () => {
    const scope = managedNetworkScope(network({ scope: 'allAccessPoints' }), groups, aps);
    assert.deepEqual(impactRows(scope, ctx('es')), [{ kind: 'scope', label: 'Alcance', value: 'Todos los puntos de acceso' }]);
    assert.deepEqual(impactRows(scope, ctx('en')), [{ kind: 'scope', label: 'Scope', value: 'All access points' }]);
    assert.equal(impactNote(scope, ctx('en')), 'This includes the access points added later.');
  });

  test('an unknown scope is stated as unknown, never guessed (the bound ids are not used)', () => {
    const scope = managedNetworkScope(network({ scope: 'unknown', apGroupIds: [G1] }), groups, aps);
    assert.deepEqual(impactRows(scope, ctx('es')), [{ kind: 'scope', label: 'Alcance', value: 'Alcance desconocido' }]);
    assert.equal(impactNote(scope, ctx('es')), translations.es.networkImpactUnknownNote);
  });

  test('a scope bound to AP groups: "N groups · M APs" and the bound groups by name (in list order), the unlisted ones counted, "None" for none', () => {
    const scope = managedNetworkScope(network({ apGroupIds: [G2, G1] }), groups, aps);
    assert.deepEqual(impactRows(scope, ctx('es')), [
      { kind: 'scope', label: 'Alcance', value: '2 grupos · 3 AP' },
      { kind: 'groups', label: 'Grupos de AP', value: 'Default, zGrupo B' },
    ]);
    assert.deepEqual(impactRows(scope, ctx('en')), [
      { kind: 'scope', label: 'Scope', value: '2 groups · 3 APs' },
      { kind: 'groups', label: 'AP groups', value: 'Default, zGrupo B' },
    ]);
    assert.equal(impactNote(scope, ctx('en')), null);
    const unresolved = managedNetworkScope(network({ apGroupIds: [G3, G_UNLISTED] }), groups, aps);
    assert.deepEqual(impactRows(unresolved, ctx('es'))[1], { kind: 'groups', label: 'Grupos de AP', value: 'Exterior, 1 grupo que no está en la lista' });
    assert.equal(impactRows(unresolved, ctx('es'))[0].value, '2 grupos · al menos 1 AP; 1 grupo vinculado no está en la lista de grupos');
    const none = managedNetworkScope(network({ apGroupIds: [] }), groups, aps);
    assert.deepEqual(impactRows(none, ctx('en')), [
      { kind: 'scope', label: 'Scope', value: '0 groups · No APs' },
      { kind: 'groups', label: 'AP groups', value: 'None' },
    ]);
  });

  test('passwordReviewSummary() (phase 20a): the password change is confirmed with the network\'s scope, its groups, the passphrase row (never the value) and the scope note', () => {
    const bound = managedNetworkScope(network({ apGroupIds: [G2, G1] }), groups, aps);
    assert.deepEqual(passwordReviewSummary(bound, ctx('es')), {
      rows: [
        { kind: 'scope', label: 'Alcance', value: '2 grupos · 3 AP' },
        { kind: 'groups', label: 'Grupos de AP', value: 'Default, zGrupo B' },
        { kind: 'passphrase', label: translations.es.networkPassphraseLabel, value: 'La que has escrito (no se muestra)' },
      ],
      notes: [],
    });
    const all = managedNetworkScope(network({ scope: 'allAccessPoints' }), groups, aps);
    assert.deepEqual(passwordReviewSummary(all, ctx('en')), {
      rows: [
        { kind: 'scope', label: 'Scope', value: 'All access points' },
        { kind: 'passphrase', label: translations.en.networkPassphraseLabel, value: 'The one you typed (not shown)' },
      ],
      notes: ['This includes the access points added later.'],
    });
    assert.equal(formatMessage(translations.en.networkPasswordReviewMessage, { name: 'Casa' }), 'Change the password of "Casa"? Devices will need the new one to join again, on its whole scope:');
    assert.match(translations.es.networkPasswordReviewMessage, /^¿Cambiar la contraseña de "\{name\}"\?/);
  });

  test('scopeSummaryText(): exact, a lower bound with its reasons, unknown', () => {
    const lower = managedNetworkScope(network({ apGroupIds: [G1] }), groups, [...aps, ap(5, '')]);
    assert.equal(scopeSummaryText(summarizeScope(lower), ctx('es').tr), '1 grupo · al menos 2 AP; no se puede identificar el grupo de 1 AP');
    const exact = managedNetworkScope(network({ apGroupIds: [G1] }), groups, aps);
    assert.equal(scopeSummaryText(summarizeScope(exact), ctx('en').tr), '1 group · 2 APs');
    const onlyUnknown = managedNetworkScope(network({ apGroupIds: [G3] }), [group(G3, 'Exterior')], [ap(6, 'Fantasma')]);
    assert.equal(scopeSummaryText(summarizeScope(onlyUnknown), ctx('en').tr), `1 group · ${translations.en.apCountUnknown}; ${translations.en.scopeUnknownApsOne}`);
  });
});

describe('findCreatedNetworkId()', () => {
  const listed = [network({ id: 'n1', name: 'Uno' }), network({ id: 'n2', name: 'Dos' }), network({ id: 'n3', name: 'Dos' })];

  test('by the id main reported when it is listed, else the ONE network with that name, else none', () => {
    assert.equal(findCreatedNetworkId('n2', 'Uno', listed), 'n2');
    assert.equal(findCreatedNetworkId(null, 'Uno', listed), 'n1');
    assert.equal(findCreatedNetworkId('gone', 'Uno', listed), 'n1');
    assert.equal(findCreatedNetworkId(null, 'Dos', listed), null);
    assert.equal(findCreatedNetworkId(null, 'Tres', listed), null);
  });
});
