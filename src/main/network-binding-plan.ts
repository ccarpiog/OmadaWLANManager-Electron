// Wi-Fi network AP-group bindings ("Broadcast on", todo.md 4.12, phase 19a;
// docs/management-design.md §3, §4.5, §5): the rules of the binding write and
// its request body. Pure; its only runtime imports are ap-group-policy.ts (the
// per-band capacity keys) and wifi-network-model.ts (the AP-group id rule and
// the read model's DTO builder, which decides the scope), both pure, so
// ControllerSession (controller-session.ts), OpenApiClient (openapi-client.ts),
// the unit tests and the smoke stub (tests/smoke/stub-main.cjs, which requires
// the compiled module) apply exactly the same rules.
//
// Write (docs/omada-openapi-ops.md, "Update SSID binding ap groups"):
//   PATCH /openapi/v1/{omadacId}/sites/{siteId}/wireless-network/ssids/{ssidId}/ap-groups
//   with exactly {apGroupIds} (buildBindingsBody(); the doc's only field,
//   required: "AP GroupId List to bind with SSID") — the COMPLETE new set of
//   bound groups, not a delta.
//
// Rules (main decides on FRESH data; the renderer may pre-check):
// - the request (no controller data, checkBindingRequest()): ids deduplicated
//   (the first occurrence kept), at least one ('groupsRequired': the write
//   never leaves a network bound to nothing — what the controller does with an
//   empty list is unknown), every id 24 hex digits (isApGroupId(); else
//   'groupNotFound', like a create's groups);
// - the scope (checkBindingScope()), from the network's fresh v2 catalog
//   entry, its fresh v1 detail and its fresh v1 bindings, decided by the read
//   model itself (networkBindingFacts() runs toManagedNetwork() of
//   wifi-network-model.ts, so the write judges a network exactly as the list
//   shows it): the device selection (`chooseDevices`) and the bands of the
//   catalog and the detail must agree (a disagreement or an unrecognized value
//   from either makes them unknown), the bindings are cross-checked as a set
//   with the detail's `apGroupIds`. An "All access points" network is refused
//   ('scopeAllAccessPoints' — spec §4.5 / §5: how the PATCH enters or leaves
//   "all devices" is unverified, so it is never sent for one, and such a
//   network is never converted into a group list), and so is every network
//   whose scope is not known to be "these AP groups" ('scopeUnknown' — e.g.
//   the catalog and the detail disagree). The security mode does not matter
//   (user decision D3: Enterprise / PPSK networks may be bound too). Finding
//   the network in a complete catalog ('networkListIncomplete' /
//   'networkNotFound' otherwise) is ControllerSession's part;
// - every requested id must be in the FRESH AP-group list ('groupNotFound'),
//   kept groups included;
// - the diff against the fresh bindings (diffBindings()): added (requested,
//   not bound), removed (bound, not requested), kept (both); nothing added and
//   nothing removed is 'nothingToChange' — no PATCH;
// - the capacity (checkBindingCapacity()), for ADDED groups only (a kept group
//   already carries the network; a removal only frees room): for every band
//   the network uses, the group's fresh `remainingBinding` (keys 0 / 1 / 2 =
//   2.4 / 5 / 6 GHz, read through toBandValues()) must be reported and above
//   0. A band reported at 0 is 'full'; a band not reported (missing, insane,
//   or no `remainingBinding` at all) is 'unknown' — fail closed, never read as
//   room left. EVERY failing group + band is collected (not just the first)
//   into one 'capacityInsufficient' refusal. Groups to add while the
//   network's bands are unknown: 'networkStateUnknown' (diagnostic "bands
//   unknown");
// - MLO, fail closed: the fresh detail's `mloEnable` (the create and
//   basic-config requests require it, so every network has one, and the 18a
//   edit already refuses a detail without it) must be a boolean before groups
//   are added — absent, null or any other type is 'networkStateUnknown'
//   (diagnostic "mlo unknown"); removals need no MLO state. An MLO network
//   needs MLO capacity on every ADDED group too: the group's remaining MLO
//   binding (MLO_REMAINING_BINDING_KEY) must be reported and above 0, else
//   the group + 'mlo' is a capacity problem ('full' / 'unknown'). The ops doc
//   documents no MLO key of `remainingBinding` (only "0:2g, 1:5g, 2:6g"; the
//   16a / 16b archives leave "an MLO key?" open), so the key is null and an
//   MLO network cannot gain a group until phase 20 verifies one live.

import type { ManagedNetwork, NetworkBand, NetworkBindingsError, NetworkBindingsResult, NetworkCapacityProblem, NetworkScope } from '../shared/types';
import { toBandValues } from './ap-group-policy';
import { isApGroupId, OpenApiSsid, OpenApiSsidBindings, OpenApiSsidDetail, toManagedNetwork } from './wifi-network-model';

// The bands of a network, in the canonical order (2.4 / 5 / 6 GHz) the
// capacity problems are listed in
const BAND_ORDER: readonly NetworkBand[] = ['band2g', 'band5g', 'band6g'];

// The `remainingBinding` key of a group's remaining MLO binding: none is
// documented (see the header), so null — an MLO network's capacity on an
// added group is always 'unknown' (fail closed). To be verified live (phase
// 20); once known, this is the only change needed
export const MLO_REMAINING_BINDING_KEY: string | null = null;

/** A refusal of the binding rules: a stable code, a codes-only diagnostic, the capacity problems. */
export interface BindingRefusal {
  ok: false;
  error: NetworkBindingsError;
  diagnostic?: string;
  capacityProblems?: NetworkCapacityProblem[];
}

/**
 * The fields of a fresh AP group the rules read (OpenApiApGroup in
 * openapi-client.ts and PolicyApGroup in ap-group-policy.ts match it
 * structurally).
 */
export interface BindingApGroup {
  id: string;
  remainingBinding?: Record<string, number>;
}

/**
 * What the fresh reads say about a network's binding: its scope, the bands it
 * uses (null: unknown), the AP groups it is bound to (null: unknown) and
 * whether MLO is enabled (null: unknown).
 */
export interface NetworkBindingFacts {
  scope: NetworkScope;
  bands: NetworkBand[] | null;
  apGroupIds: string[] | null;
  mloEnabled: boolean | null;
}

/** The added / removed / kept groups of a binding change. */
export interface BindingDiff {
  added: string[];
  removed: string[];
  kept: string[];
}

/** A binding write that passed every rule: the complete new set (request order) and its diff. */
export interface NetworkBindingPlan extends BindingDiff {
  apGroupIds: string[];
}

/** The outcome of planNetworkBindings(): the plan, or a refusal. */
export type BindingPlanOutcome = { ok: true; plan: NetworkBindingPlan } | BindingRefusal;

/**
 * Builds a refusal.
 * @param {NetworkBindingsError} error - The stable code.
 * @param {string} [diagnostic] - A codes-only diagnostic.
 * @returns {BindingRefusal} The refusal.
 */
function refuse(error: NetworkBindingsError, diagnostic?: string): BindingRefusal {
  return diagnostic === undefined ? { ok: false, error } : { ok: false, error, diagnostic };
}

/**
 * Tells whether a value is a remaining-binding count: a non-negative safe
 * integer (the rule toBandValues() of ap-group-policy.ts applies to the radio
 * bands).
 * @param {unknown} value - The value.
 * @returns {value is number} True for a count.
 */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Recognizes a band list: a non-empty array of distinct known bands.
 * @param {unknown} value - The value.
 * @returns {value is NetworkBand[]} True for a band list.
 */
function isBandList(value: unknown): value is NetworkBand[] {
  return (
    Array.isArray(value) && value.length > 0 && value.every((band) => BAND_ORDER.includes(band as NetworkBand)) && new Set(value).size === value.length
  );
}

/**
 * Recognizes a bound AP-group id list (every entry a 24-hex AP-group id).
 * @param {unknown} value - The value.
 * @returns {value is string[]} True for an AP-group id list.
 */
function isApGroupIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isApGroupId);
}

/**
 * What the network's FRESH v2 catalog entry, v1 detail and v1 bindings say
 * about its binding (see the header), by the read model's own rules: the
 * scope, the bands and the bound ids are those of toManagedNetwork() — the
 * DTO the network list shows —, so the catalog and the detail must agree on
 * the device selection and the bands ("All access points" only for
 * `chooseDevices` 0, "AP groups" only for `chooseDevices` 1 with known
 * bindings, unknown otherwise, a disagreement included), and the bindings
 * answer is cross-checked as a set with the detail's `apGroupIds`. An entry
 * and a detail that do not name the same usable network (toManagedNetwork()
 * throws) know nothing: unknown scope, bands and bindings. The MLO state is
 * the detail's raw `mloEnable` when it is a boolean, else unknown.
 * @param {OpenApiSsid} entry - The network's validated fresh catalog entry.
 * @param {OpenApiSsidDetail} detail - The validated fresh detail.
 * @param {OpenApiSsidBindings} bindings - The validated fresh bindings.
 * @param {unknown} mloEnable - The fresh detail's `mloEnable` as the controller sent it.
 * @returns {NetworkBindingFacts} The facts.
 */
export function networkBindingFacts(entry: OpenApiSsid, detail: OpenApiSsidDetail, bindings: OpenApiSsidBindings, mloEnable: unknown): NetworkBindingFacts {
  const mloEnabled = typeof mloEnable === 'boolean' ? mloEnable : null;
  let network: ManagedNetwork;
  try {
    network = toManagedNetwork(entry, detail, bindings);
  } catch {
    return { scope: 'unknown', bands: null, apGroupIds: null, mloEnabled };
  }
  return {
    scope: network.scope,
    bands: network.bands === null ? null : BAND_ORDER.filter((band) => (network.bands as NetworkBand[]).includes(band)),
    apGroupIds: network.apGroupIds === null ? null : [...network.apGroupIds],
    mloEnabled
  };
} // End of function networkBindingFacts()

/**
 * Checks the requested groups against every rule that needs no controller
 * data (see the header): deduplicated in request order, at least one
 * ('groupsRequired'), every id 24 hex digits ('groupNotFound'). Nothing is
 * sent for a refused request.
 * @param {unknown} apGroupIds - The requested ids (shape-checked by the IPC guard).
 * @returns {{ ok: true; apGroupIds: string[] } | BindingRefusal} The deduplicated ids, or a refusal.
 */
export function checkBindingRequest(apGroupIds: unknown): { ok: true; apGroupIds: string[] } | BindingRefusal {
  const ids = Array.isArray(apGroupIds) ? [...new Set(apGroupIds as unknown[])] : [];
  if (ids.length === 0) {
    return refuse('groupsRequired');
  }
  if (!ids.every(isApGroupId)) {
    return refuse('groupNotFound');
  }
  return { ok: true, apGroupIds: ids as string[] };
} // End of function checkBindingRequest()

/**
 * The scope rule (see the header): refused for an "All access points"
 * network ('scopeAllAccessPoints') and for any network whose scope is not
 * known to be a set of AP groups ('scopeUnknown').
 * @param {NetworkBindingFacts} facts - The fresh facts (networkBindingFacts()).
 * @returns {BindingRefusal | null} The refusal, or null when the binding may change.
 */
export function checkBindingScope(facts: NetworkBindingFacts): BindingRefusal | null {
  if (facts.scope === 'allAccessPoints') {
    return refuse('scopeAllAccessPoints');
  }
  if (facts.scope !== 'apGroups' || !isApGroupIdList(facts.apGroupIds)) {
    return refuse('scopeUnknown');
  }
  return null;
}

/**
 * The diff of a binding change: added (requested, not bound — request order),
 * removed (bound, not requested — current order) and kept (both — request
 * order). Ids are compared exactly.
 * @param {readonly string[]} current - The fresh bindings.
 * @param {readonly string[]} requested - The requested set.
 * @returns {BindingDiff} The diff.
 */
export function diffBindings(current: readonly string[], requested: readonly string[]): BindingDiff {
  const bound = new Set(current);
  const wanted = new Set(requested);
  return {
    added: [...wanted].filter((id) => !bound.has(id)),
    removed: [...bound].filter((id) => !wanted.has(id)),
    kept: [...wanted].filter((id) => bound.has(id))
  };
}

/**
 * A group's remaining MLO binding (see the header): the count reported under
 * `key` of its fresh `remainingBinding`, or undefined when there is no key
 * (MLO_REMAINING_BINDING_KEY is null: none is documented), no record, or no
 * sane count under it — never read as room left.
 * @param {unknown} remainingBinding - The group's `remainingBinding` record.
 * @param {string | null} key - The MLO key.
 * @returns {number | undefined} The count, or undefined when unknown.
 */
export function mloRemainingBinding(remainingBinding: unknown, key: string | null): number | undefined {
  if (key === null || typeof remainingBinding !== 'object' || remainingBinding === null || !Object.prototype.hasOwnProperty.call(remainingBinding, key)) {
    return undefined;
  }
  const value = (remainingBinding as Record<string, unknown>)[key];
  return isCount(value) ? value : undefined;
}

/**
 * The capacity rule (see the header): for every ADDED group and every band
 * the network uses — and MLO, for an MLO network —, the group's fresh
 * remaining binding there must be reported and above 0. Collects EVERY
 * failing group + band — 'full' (reported at 0) or 'unknown' (not reported,
 * also for a group missing from `groups`, and MLO while its key is unknown)
 * — in added-group order, then band order, 'mlo' last.
 * @param {readonly string[]} added - The groups the change adds.
 * @param {readonly NetworkBand[]} bands - The bands the network uses.
 * @param {readonly BindingApGroup[]} groups - The fresh AP-group list.
 * @param {boolean} [mloEnabled] - Whether the network has MLO enabled (default false).
 * @param {string | null} [mloKey] - The MLO `remainingBinding` key (default MLO_REMAINING_BINDING_KEY).
 * @returns {NetworkCapacityProblem[]} The problems (empty: every added group has room).
 */
export function checkBindingCapacity(
  added: readonly string[],
  bands: readonly NetworkBand[],
  groups: readonly BindingApGroup[],
  mloEnabled = false,
  mloKey: string | null = MLO_REMAINING_BINDING_KEY
): NetworkCapacityProblem[] {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const usedBands = BAND_ORDER.filter((band) => bands.includes(band));
  const problems: NetworkCapacityProblem[] = [];
  for (const apGroupId of added) {
    const record = byId.get(apGroupId)?.remainingBinding;
    const remaining = toBandValues(record);
    for (const band of usedBands) {
      const value = remaining?.[band];
      if (value === undefined) {
        problems.push({ apGroupId, band, reason: 'unknown' });
      } else if (value <= 0) {
        problems.push({ apGroupId, band, reason: 'full' });
      }
    } // End of the loop over the network's bands
    if (mloEnabled) {
      const mlo = mloRemainingBinding(record, mloKey);
      if (mlo === undefined) {
        problems.push({ apGroupId, band: 'mlo', reason: 'unknown' });
      } else if (mlo <= 0) {
        problems.push({ apGroupId, band: 'mlo', reason: 'full' });
      }
    }
  } // End of the loop over the added groups
  return problems;
} // End of function checkBindingCapacity()

/**
 * The codes-only diagnostic of a 'capacityInsufficient' refusal: how many
 * group + band pairs are full and how many unknown (the pairs themselves are
 * in `capacityProblems`).
 * @param {readonly NetworkCapacityProblem[]} problems - The problems.
 * @returns {string} E.g. "capacity: 2 full, 1 unknown".
 */
export function capacityDiagnostic(problems: readonly NetworkCapacityProblem[]): string {
  const full = problems.filter((problem) => problem.reason === 'full').length;
  return `capacity: ${full} full, ${problems.length - full} unknown`;
}

/**
 * Plans one binding write on fresh data, applying every rule of the header in
 * this order: the request (checkBindingRequest()), the scope
 * (checkBindingScope()), every requested group in the fresh AP-group list,
 * the diff ('nothingToChange' when it changes nothing), then — when groups
 * are added — the network's bands, its MLO state and the capacity of every
 * added group.
 * @param {unknown} requested - The requested ids.
 * @param {NetworkBindingFacts} facts - The fresh facts of the network (networkBindingFacts()).
 * @param {readonly BindingApGroup[]} groups - The fresh, complete AP-group list.
 * @returns {BindingPlanOutcome} The plan, or a refusal.
 */
export function planNetworkBindings(requested: unknown, facts: NetworkBindingFacts, groups: readonly BindingApGroup[]): BindingPlanOutcome {
  const request = checkBindingRequest(requested);
  if (!request.ok) {
    return request;
  }
  const scope = checkBindingScope(facts);
  if (scope !== null) {
    return scope;
  }
  const listed = new Set(groups.map((group) => group.id));
  if (!request.apGroupIds.every((id) => listed.has(id))) {
    return refuse('groupNotFound');
  }
  const diff = diffBindings(facts.apGroupIds as string[], request.apGroupIds);
  if (diff.added.length === 0 && diff.removed.length === 0) {
    return refuse('nothingToChange');
  }
  if (diff.added.length > 0) {
    if (!isBandList(facts.bands)) {
      return refuse('networkStateUnknown', 'bands unknown');
    }
    if (typeof facts.mloEnabled !== 'boolean') {
      return refuse('networkStateUnknown', 'mlo unknown');
    }
    const problems = checkBindingCapacity(diff.added, facts.bands, groups, facts.mloEnabled);
    if (problems.length > 0) {
      return { ok: false, error: 'capacityInsufficient', diagnostic: capacityDiagnostic(problems), capacityProblems: problems };
    }
  }
  return { ok: true, plan: { apGroupIds: [...request.apGroupIds], ...diff } };
} // End of function planNetworkBindings()

/**
 * The reply of a refused binding write: its code, plus the codes-only
 * diagnostic and the capacity problems (copied) when the refusal has them.
 * @param {BindingRefusal} refusal - The refusal.
 * @returns {NetworkBindingsResult} The reply.
 */
export function bindingRefusalReply(refusal: BindingRefusal): NetworkBindingsResult {
  const reply: NetworkBindingsResult = { success: false, error: refusal.error };
  if (refusal.diagnostic !== undefined) {
    reply.diagnostic = refusal.diagnostic;
  }
  if (refusal.capacityProblems !== undefined) {
    reply.capacityProblems = refusal.capacityProblems.map((problem) => ({ apGroupId: problem.apGroupId, band: problem.band, reason: problem.reason }));
  }
  return reply;
} // End of function bindingRefusalReply()

/**
 * The body of `PATCH …/ssids/{ssidId}/ap-groups`: exactly `{apGroupIds}`, the
 * complete new set.
 * @param {readonly string[]} apGroupIds - The planned ids.
 * @returns {{ apGroupIds: string[] }} The body.
 */
export function buildBindingsBody(apGroupIds: readonly string[]): { apGroupIds: string[] } {
  return { apGroupIds: [...apGroupIds] };
}

/**
 * Sanity check of the ids handed to the Open API client (defense in depth;
 * the rules proper are applied above): a non-empty array of distinct 24-hex
 * AP-group ids.
 * @param {unknown} apGroupIds - The ids.
 * @returns {boolean} True when sane.
 */
export function isSaneBindingIds(apGroupIds: unknown): apGroupIds is string[] {
  return Array.isArray(apGroupIds) && apGroupIds.length > 0 && apGroupIds.every(isApGroupId) && new Set(apGroupIds).size === apGroupIds.length;
}
