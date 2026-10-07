// ============================================================================
// Pure logic of the Wi-Fi networks view on its managed (Open API) source
// (todo.md 4.10, phase 17b; docs/management-design.md §4.5 and §4.6),
// DOM-free so the unit tests can run it in plain Node:
//   - when the view reads the managed source (networkManagementOn():
//     connected with a session nonce and data on screen, no read-only reason
//     and `manageWifiNetworks` on), when its 14a view is only the fallback
//     of a capability check still running (networkManagementChecking()), and
//     which state it shows (networksViewMode(): the 14a internal-data view,
//     the managed list — stale after a failed re-read —, its loading
//     skeleton or its error state with Retry); whether that source is
//     settled, so the Back history may be checked against it
//     (networksSourceSettled());
//   - whether a reply of getManagedNetworks() is still the one to take
//     (isCurrentNetworkRead(): the same session generation, session nonce
//     and read number — a late reply of an older read changes nothing), and
//     what a taken reply leaves (settleNetworkRead(): a new list replaces
//     the held one whole; a failed re-read keeps the last good list of the
//     same session, stale; a failed first read shows the error state);
//   - the boundary validation of that reply (parseManagedNetworksResult()):
//     every network is copied field by field from an allowlist, and the
//     WHOLE reply is refused when any network breaks the DTO contract
//     (never a partial list); the message key of every failure;
//   - the managed rows (sorted by name) and each network's scope from the
//     DTO and the AP-group data on screen (managedNetworkScope(): "All access
//     points", "N groups · M APs" — a lower bound while some APs' groups or
//     some bound groups cannot be resolved — or an explicit unknown scope,
//     never guessed), the search and the selection lookup — by a typed key
//     (NetworkKey: an id or a name, each resolved only in its own
//     namespace; a name several networks share designates none), also
//     inside the Back history's items (networkHistoryItem());
//   - the message keys of the security, bands, enabled and passphrase values
//     (an unknown value is stated as unknown, never invented; the passphrase
//     only as set / none — the DTO never carries a key).
// The message keys below are keys of the i18n table (Translations in
// i18n.ts); the DOM modules look them up with t()/tFormat(), which checks
// them against the table at compile time.
// ============================================================================

import type {
  AccessPoint,
  GroupModel,
  ManagedNetwork,
  ManagedNetworksError,
  ManagementCapabilities,
  NetworkBand,
  NetworkScope,
  NetworkSecurity,
  WlanGroup,
} from '../shared/types';
import { WRITABLE_GROUP_ID_REGEX } from './group-management';
import type { NetworkScopeKind } from './inventory-model';
import { normalizeSearch } from './move-plan';
import { parseDiagnostic } from './validation';
import { readOnlyReason } from './view-state';

// Network ids main sends (SSID_ID_REGEX in src/main/wifi-network-model.ts)
export const NETWORK_ID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

// Longest network name main sends (MAX_NETWORK_NAME_LENGTH there)
export const MAX_NETWORK_NAME_LENGTH = 128;

// Most networks one reply may carry (MAX_MANAGED_NETWORKS there)
export const MAX_MANAGED_NETWORKS = 128;

// The DTO's value sets (src/shared/types.ts), in display order
const SECURITIES: readonly NetworkSecurity[] = ['open', 'wpaEnterprise', 'wpaPersonal', 'ppskWithoutRadius', 'ppskWithRadius', 'unknown'];
const BANDS: readonly NetworkBand[] = ['band2g', 'band5g', 'band6g'];
const SCOPES: readonly NetworkScope[] = ['allAccessPoints', 'apGroups', 'unknown'];

// Every ManagedNetworksError main can answer with
const MANAGED_NETWORKS_ERRORS: readonly ManagedNetworksError[] = ['notConnected', 'superseded', 'managementUnavailable', 'networkListIncomplete', 'requestFailed'];

/**
 * Why the managed list cannot be shown: main's code, 'invalidReply' (a reply
 * that breaks the DTO contract — refused whole, never shown in part) or
 * 'failed' (the call threw, or a failure with a code the renderer does not
 * know).
 */
export type NetworkFailure = ManagedNetworksError | 'invalidReply' | 'failed';

// The message key of every failure; the Record type makes the compiler
// require each one
const FAILURE_KEYS = {
  notConnected: 'managedNetworksErrorNotConnected',
  superseded: 'managedNetworksErrorSuperseded',
  managementUnavailable: 'managedNetworksErrorManagementUnavailable',
  networkListIncomplete: 'managedNetworksErrorListIncomplete',
  requestFailed: 'managedNetworksErrorRequestFailed',
  invalidReply: 'managedNetworksErrorInvalidReply',
  failed: 'managedNetworksErrorFailed',
} as const satisfies Record<NetworkFailure, string>;

/** The message key of a managed-networks failure (a key of the i18n table). */
export type NetworkFailureKey = (typeof FAILURE_KEYS)[keyof typeof FAILURE_KEYS];

// The message key of every security mode ('unknown' as the master list
// states it; the detail uses networkValueUnknown)
const SECURITY_KEYS = {
  open: 'securityOpen',
  wpaEnterprise: 'securityWpaEnterprise',
  wpaPersonal: 'securityWpaPersonal',
  ppskWithoutRadius: 'securityPpskWithoutRadius',
  ppskWithRadius: 'securityPpskWithRadius',
  unknown: null,
} as const satisfies Record<NetworkSecurity, string | null>;

/** The message key of a known security mode. */
export type SecurityKey = NonNullable<(typeof SECURITY_KEYS)[NetworkSecurity]>;

/**
 * Where the managed list (getManagedNetworks()) is: not asked for
 * (management off, or not connected), being read, read, or not readable.
 */
export type ManagedNetworksStatus = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * What the Wi-Fi networks view shows once data is loaded:
 * - 'internal': the 14a view from the internal data (management off, or its
 *   capabilities still unknown / being checked);
 * - 'managedLoading': the loading skeleton while the first managed read runs;
 * - 'managedReady': the managed list (also while a re-read runs: it stays on
 *   screen until the new reply arrives; and after a failed re-read, stale,
 *   with the refresh-error notice);
 * - 'managedFailed': the §4.6 error state with Retry after a failed first
 *   read (no list at all).
 */
export type NetworksViewMode = 'internal' | 'managedLoading' | 'managedReady' | 'managedFailed';

/** Why a managed read failed: the failure and main's codes-only diagnostic (or null). */
export interface NetworkFailureDetail {
  error: NetworkFailure;
  diagnostic: string | null;
}

/** A failed getManagedNetworks() reply after validation. */
export interface NetworkFailureReply extends NetworkFailureDetail {
  ok: false;
}

/**
 * A network to find on the managed list, in ONE namespace: its id (the
 * managed list's own selection, kept in the Back history) or its name (a
 * cross-link, or a selection made on the 14a view — the internal data has
 * no ids). An id never matches a name and a name never matches an id.
 */
export type NetworkKey = { kind: 'id'; value: string } | { kind: 'name'; value: string };

/** The session a held managed list was read for, and when (ms since the epoch). */
export interface NetworkReadStamp {
  generation: number;
  nonce: string;
  readAt: number;
}

/** The managed list the renderer holds: the networks of the last good read, with its stamp. */
export interface HeldManagedNetworks extends NetworkReadStamp {
  networks: ManagedNetwork[];
}

/**
 * What a taken reply leaves (settleNetworkRead()): the list now held (null
 * for none), whether the read succeeded, and why it failed.
 */
export type NetworkReadSettlement =
  | { status: 'ready'; held: HeldManagedNetworks; failure: null }
  | { status: 'failed'; held: HeldManagedNetworks | null; failure: NetworkFailureDetail };

/** A getManagedNetworks() reply after validation. */
export type ParsedManagedNetworks = { ok: true; networks: ManagedNetwork[] } | NetworkFailureReply;

/** What networkManagementOn() decides from (the renderer state). */
export interface NetworkManagementInput {
  isConnected: boolean;
  // A session nonce of the connect result is held
  hasSessionNonce: boolean;
  // Data from a successful load is on screen
  hasData: boolean;
  groupModel: GroupModel | null;
  capabilities: ManagementCapabilities | null;
}

/** The identity of one managed read: the session it belongs to and its number. */
export interface NetworkReadTicket {
  generation: number;
  nonce: string;
  request: number;
}

/** The renderer's current session and latest read number. */
export interface NetworkReadState {
  generation: number;
  nonce: string | null;
  request: number;
}

/**
 * Where a managed network is broadcast, resolved against the data on screen:
 * - 'allAccessPoints': the controller reports "all access points";
 * - 'unknown': the controller did not report it clearly (never guessed);
 * - 'apGroups': bound to `groupCount` AP groups — `groups` the bound groups
 *   the group list has (in listing order), `unresolvedGroupCount` the bound
 *   ids it does not have; `aps` the APs whose group resolves (by name) to
 *   exactly one bound group, `unknownApCount` the APs that may broadcast it
 *   but whose group cannot be resolved (no group, a group not in the list,
 *   or a name several groups share, one of which is bound).
 */
export type ManagedScope =
  | { kind: 'allAccessPoints' }
  | { kind: 'unknown' }
  | {
      kind: 'apGroups';
      groupCount: number;
      groups: WlanGroup[];
      unresolvedGroupCount: number;
      aps: AccessPoint[];
      unknownApCount: number;
    };

/**
 * What a scope's text says: "All access points", "Unknown scope", or "N
 * groups · M APs" with how exact M is (a lower bound, with the reasons,
 * while some APs' groups or some bound groups cannot be resolved).
 */
export type ScopeSummary =
  | { kind: 'allAccessPoints' }
  | { kind: 'unknown' }
  | { kind: 'apGroups'; groupCount: number; apCount: number; countKind: NetworkScopeKind; unknownApCount: number; unresolvedGroupCount: number };

/** One row of the managed master list: the network and its resolved scope. */
export interface ManagedNetworkRow {
  network: ManagedNetwork;
  scope: ManagedScope;
}

// ============================================================================
// Source and reads
// ============================================================================

/**
 * Tells whether the Wi-Fi networks view reads the managed source: connected
 * with a session nonce and the data of an Omada 6.3+ controller (the
 * 'apGroup' group model) on screen, readOnlyReason() — the read-only
 * banner's one source — gives no reason (Omada 6.3+, every management check
 * passed), and the capabilities say Wi-Fi network management is on. While
 * the capabilities are unknown or being checked it is off (the 14a view).
 * @param {NetworkManagementInput} input - The relevant renderer state.
 * @returns {boolean} True when the managed source is used.
 */
export function networkManagementOn(input: NetworkManagementInput): boolean {
  if (!input.isConnected || !input.hasSessionNonce || !input.hasData || input.groupModel !== 'apGroup' || input.capabilities === null) {
    return false;
  }
  if (input.capabilities.manageWifiNetworks !== true) {
    return false;
  }
  return readOnlyReason({ hasData: input.hasData, groupModel: input.groupModel, capabilities: input.capabilities }) === null;
} // End of function networkManagementOn()

/**
 * Tells whether the 14a view is only the fallback of a capability check
 * still running: connected with a session nonce and the data of an Omada
 * 6.3+ controller on screen, the capabilities unknown (a connection's first
 * check, or "Test management access" checking again). Once the check
 * settles, management is either on (the managed list) or definitively off.
 * @param {NetworkManagementInput} input - The relevant renderer state.
 * @returns {boolean} True while the check runs.
 */
export function networkManagementChecking(input: NetworkManagementInput): boolean {
  return input.isConnected && input.hasSessionNonce && input.hasData && input.groupModel === 'apGroup' && input.capabilities === null;
}

/**
 * Picks what the view shows: the 14a view while management is off; with it
 * on, the managed list while one is held (also during a re-read, and stale
 * after a failed re-read), the error state after a failed first read, else
 * the loading skeleton.
 * @param {boolean} managementOn - networkManagementOn() for the state now.
 * @param {ManagedNetworksStatus} status - Where the managed read is.
 * @param {boolean} hasNetworks - A managed list is held.
 * @returns {NetworksViewMode} The mode.
 */
export function networksViewMode(managementOn: boolean, status: ManagedNetworksStatus, hasNetworks: boolean): NetworksViewMode {
  if (!managementOn) return 'internal';
  if (hasNetworks) return 'managedReady';
  return status === 'failed' ? 'managedFailed' : 'managedLoading';
}

/**
 * Tells whether the managed list on screen is stale: the view shows it and
 * the latest read of it failed (the refresh-error notice states it).
 * @param {NetworksViewMode} mode - The view's mode.
 * @param {ManagedNetworksStatus} status - Where the managed read is.
 * @returns {boolean} True for a stale list.
 */
export function isManagedListStale(mode: NetworksViewMode, status: ManagedNetworksStatus): boolean {
  return mode === 'managedReady' && status === 'failed';
}

/**
 * Tells whether the view's source is settled, so the Back history's network
 * items may be checked against it: the managed list on screen, or the 14a
 * view once management is definitively off. Not while the managed list is
 * loading or failed, nor while the 14a view is only a capability check's
 * fallback (a managed network's item would be dropped although the managed
 * list may come back with it).
 * @param {NetworksViewMode} mode - The view's mode.
 * @param {boolean} checking - networkManagementChecking() for the state now.
 * @returns {boolean} True when settled.
 */
export function networksSourceSettled(mode: NetworksViewMode, checking: boolean): boolean {
  if (mode === 'internal') return !checking;
  return mode === 'managedReady';
}

/**
 * Tells whether a reply belongs to the read the view is waiting for: the same
 * session generation and session nonce as when it was asked, and no newer
 * read started since. Anything else is a late reply and is discarded.
 * @param {NetworkReadTicket} ticket - The read the reply answers.
 * @param {NetworkReadState} current - The renderer's state now.
 * @returns {boolean} True when the reply may be taken.
 */
export function isCurrentNetworkRead(ticket: NetworkReadTicket, current: NetworkReadState): boolean {
  return ticket.generation === current.generation && ticket.nonce === current.nonce && ticket.request === current.request;
}

/**
 * Tells whether a held list was read for a session: the same session
 * generation and session nonce.
 * @param {NetworkReadStamp | null} stamp - The held list's stamp, or null when none is held.
 * @param {{ generation: number; nonce: string }} session - The session.
 * @returns {boolean} True when a list is held for that session.
 */
export function isHeldForSession(stamp: NetworkReadStamp | null, session: { generation: number; nonce: string }): boolean {
  return stamp !== null && stamp.generation === session.generation && stamp.nonce === session.nonce;
}

/**
 * Settles a taken reply (isCurrentNetworkRead() passed) against the list
 * held: a validated list replaces it WHOLE (stamped with the read's session
 * and `now`); a failure (an error code, a call that threw, a malformed
 * reply) keeps the held list as it was — never mixed with the new reply —
 * when it was read for the same session (a failed re-read: the list stays,
 * stale), else holds none (a failed first read: the error state).
 * @param {HeldManagedNetworks | null} held - The list held now, or null.
 * @param {NetworkReadTicket} ticket - The read the reply answers.
 * @param {ParsedManagedNetworks} parsed - The validated reply.
 * @param {number} now - The time of the reply (ms since the epoch).
 * @returns {NetworkReadSettlement} What the reply leaves.
 */
export function settleNetworkRead(held: HeldManagedNetworks | null, ticket: NetworkReadTicket, parsed: ParsedManagedNetworks, now: number): NetworkReadSettlement {
  if (parsed.ok) {
    return { status: 'ready', held: { networks: parsed.networks, generation: ticket.generation, nonce: ticket.nonce, readAt: now }, failure: null };
  }
  const failure: NetworkFailureDetail = { error: parsed.error, diagnostic: parsed.diagnostic };
  return { status: 'failed', held: isHeldForSession(held, ticket) ? held : null, failure };
}

// ============================================================================
// Reply validation
// ============================================================================

/**
 * Tells whether a value is a plain (non-array) object.
 * @param {unknown} value - The candidate.
 * @returns {value is Record<string, unknown>} True for an object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Tells whether a value is one of a set of strings.
 * @param {readonly T[]} values - The allowed values.
 * @param {unknown} value - The candidate.
 * @returns {value is T} True for an allowed value.
 */
function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

/**
 * Tells whether a value is a boolean or null (a DTO tri-state).
 * @param {unknown} value - The candidate.
 * @returns {value is boolean | null} True for true, false or null.
 */
function isTriState(value: unknown): value is boolean | null {
  return value === null || typeof value === 'boolean';
}

/**
 * Validates a DTO band list: null (unknown) or a non-empty list of distinct
 * known bands, returned in the order 2.4 / 5 / 6 GHz.
 * @param {unknown} raw - The candidate.
 * @returns {NetworkBand[] | null | undefined} The bands, null for unknown, undefined when invalid.
 */
function parseBands(raw: unknown): NetworkBand[] | null | undefined {
  if (raw === null) return null;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > BANDS.length) return undefined;
  if (!raw.every(band => isOneOf(BANDS, band)) || new Set(raw).size !== raw.length) return undefined;
  return BANDS.filter(band => raw.includes(band));
}

/**
 * Validates a DTO list of bound AP-group ids: null (unknown) or distinct
 * 24-hex-digit ids (the rule main applies to every bound id).
 * @param {unknown} raw - The candidate.
 * @returns {string[] | null | undefined} The ids, null for unknown, undefined when invalid.
 */
function parseGroupIds(raw: unknown): string[] | null | undefined {
  if (raw === null) return null;
  if (!Array.isArray(raw)) return undefined;
  if (!raw.every(id => typeof id === 'string' && WRITABLE_GROUP_ID_REGEX.test(id)) || new Set(raw).size !== raw.length) return undefined;
  return [...(raw as string[])];
}

/**
 * Validates one ManagedNetwork of a reply and copies it field by field (no
 * other key is ever kept): an id main could send, a non-empty name of at
 * most 128 characters, a known security mode and scope, the tri-states, the
 * band and AP-group id lists, and known bound ids for an 'apGroups' scope.
 * @param {unknown} raw - The candidate.
 * @returns {ManagedNetwork | null} The network, or null when it breaks the contract.
 */
function parseNetwork(raw: unknown): ManagedNetwork | null {
  if (!isRecord(raw)) return null;
  const { id, name, security, enabled, hasPassphrase, scope } = raw;
  if (typeof id !== 'string' || !NETWORK_ID_REGEX.test(id)) return null;
  if (typeof name !== 'string' || name === '' || name.length > MAX_NETWORK_NAME_LENGTH) return null;
  if (!isOneOf(SECURITIES, security) || !isOneOf(SCOPES, scope)) return null;
  if (!isTriState(enabled) || !isTriState(hasPassphrase)) return null;
  const bands = parseBands(raw.bands);
  const apGroupIds = parseGroupIds(raw.apGroupIds);
  if (bands === undefined || apGroupIds === undefined) return null;
  if (scope === 'apGroups' && apGroupIds === null) return null;
  return { id, name, security, bands, enabled, hasPassphrase, scope, apGroupIds };
} // End of function parseNetwork()

/**
 * Tells whether a value is a known ManagedNetworksError.
 * @param {unknown} value - The candidate.
 * @returns {value is ManagedNetworksError} True for a known code.
 */
export function isManagedNetworksError(value: unknown): value is ManagedNetworksError {
  return isOneOf(MANAGED_NETWORKS_ERRORS, value);
}

/**
 * Validates a getManagedNetworks() reply. A success needs a list of at most
 * MAX_MANAGED_NETWORKS networks that ALL pass parseNetwork() with distinct
 * ids — one bad entry refuses the whole reply ('invalidReply'), so a partial
 * list is never shown. A failure keeps main's known code (an unknown one is
 * 'failed') and its codes-only diagnostic when well-formed. Anything else is
 * 'invalidReply'.
 * @param {unknown} raw - The reply received over IPC.
 * @returns {ParsedManagedNetworks} The validated reply.
 */
export function parseManagedNetworksResult(raw: unknown): ParsedManagedNetworks {
  const invalid: NetworkFailureReply = { ok: false, error: 'invalidReply', diagnostic: null };
  if (!isRecord(raw)) return invalid;
  if (raw.success === false) {
    return { ok: false, error: isManagedNetworksError(raw.error) ? raw.error : 'failed', diagnostic: parseDiagnostic(raw.diagnostic) };
  }
  if (raw.success !== true || !Array.isArray(raw.networks) || raw.networks.length > MAX_MANAGED_NETWORKS) return invalid;
  const networks: ManagedNetwork[] = [];
  const ids = new Set<string>();
  for (const entry of raw.networks) {
    const network = parseNetwork(entry);
    if (network === null || ids.has(network.id)) return invalid;
    ids.add(network.id);
    networks.push(network);
  } // End of the loop that validates every network of the reply
  return { ok: true, networks };
} // End of function parseManagedNetworksResult()

/**
 * The message key of a managed-networks failure.
 * @param {NetworkFailure} failure - Main's code, 'invalidReply' or 'failed'.
 * @returns {NetworkFailureKey} Its key.
 */
export function networkFailureKey(failure: NetworkFailure): NetworkFailureKey {
  return FAILURE_KEYS[failure];
}

// ============================================================================
// Scopes and rows
// ============================================================================

/**
 * Resolves a network's scope against the groups and APs on screen. "All
 * access points" and an unknown scope come from the DTO alone (an unknown
 * scope never uses the bound ids: they are not trusted then). For a scope
 * bound to AP groups, each AP is placed by its group name like the 14a view
 * does: in a bound group when its name resolves to exactly one listed group
 * that is bound; "may broadcast it" (unknown) when it reports no group, a
 * group the list does not have, or a name several groups share and one of
 * them is bound. A network bound to no group is broadcast by no AP.
 * @param {ManagedNetwork} network - The network.
 * @param {readonly WlanGroup[]} groups - The loaded groups.
 * @param {readonly AccessPoint[]} accessPoints - The loaded APs, in list order.
 * @returns {ManagedScope} The resolved scope.
 */
export function managedNetworkScope(network: ManagedNetwork, groups: readonly WlanGroup[], accessPoints: readonly AccessPoint[]): ManagedScope {
  if (network.scope === 'allAccessPoints') return { kind: 'allAccessPoints' };
  if (network.scope !== 'apGroups' || network.apGroupIds === null) return { kind: 'unknown' };

  const boundIds = new Set(network.apGroupIds);
  const bound = groups.filter(group => boundIds.has(group.wlanId));
  const listedIds = new Set(groups.map(group => group.wlanId));
  const unresolvedGroupCount = [...boundIds].filter(id => !listedIds.has(id)).length;
  const aps: AccessPoint[] = [];
  let unknownApCount = 0;
  // Bound to no group: no AP broadcasts it, whatever its group
  const placeable = boundIds.size > 0 ? accessPoints : [];
  for (const ap of placeable) {
    const named = ap.wlanGroup === '' ? [] : groups.filter(group => group.wlanName === ap.wlanGroup);
    if (named.length === 0) {
      unknownApCount++;
    } else if (named.some(group => boundIds.has(group.wlanId))) {
      if (named.length === 1) {
        aps.push(ap);
      } else {
        unknownApCount++;
      }
    }
  } // End of the loop that places every AP against the bound groups
  return { kind: 'apGroups', groupCount: boundIds.size, groups: bound, unresolvedGroupCount, aps, unknownApCount };
} // End of function managedNetworkScope()

/**
 * Summarizes a scope for its text: how many groups and APs, and whether the
 * AP count is exact, a lower bound ("at least M") or unknown (none placed
 * while some may broadcast it) — a lower bound whenever some APs' groups or
 * some bound groups cannot be resolved, never presented as exact.
 * @param {ManagedScope} scope - The resolved scope.
 * @returns {ScopeSummary} The summary.
 */
export function summarizeScope(scope: ManagedScope): ScopeSummary {
  if (scope.kind !== 'apGroups') return { kind: scope.kind };
  const apCount = scope.aps.length;
  let countKind: NetworkScopeKind = 'exact';
  if (scope.unknownApCount > 0 || scope.unresolvedGroupCount > 0) {
    countKind = apCount > 0 ? 'atLeast' : 'unknown';
  }
  return {
    kind: 'apGroups',
    groupCount: scope.groupCount,
    apCount,
    countKind,
    unknownApCount: scope.unknownApCount,
    unresolvedGroupCount: scope.unresolvedGroupCount,
  };
} // End of function summarizeScope()

/**
 * Builds the managed master list: one row per network with its resolved
 * scope, sorted by name (networks with the same name keep the controller's
 * order).
 * @param {readonly ManagedNetwork[]} networks - The managed networks.
 * @param {readonly WlanGroup[]} groups - The loaded groups.
 * @param {readonly AccessPoint[]} accessPoints - The loaded APs.
 * @returns {ManagedNetworkRow[]} The rows.
 */
export function buildManagedNetworkRows(networks: readonly ManagedNetwork[], groups: readonly WlanGroup[], accessPoints: readonly AccessPoint[]): ManagedNetworkRow[] {
  return networks
    .map(network => ({ network, scope: managedNetworkScope(network, groups, accessPoints) }))
    .sort((a, b) => a.network.name.localeCompare(b.network.name));
}

/**
 * Tells whether a managed row matches the view's search: by the network
 * name or the name of any bound group the list has (case-insensitive
 * substring, like the 14a view).
 * @param {ManagedNetworkRow} row - The row.
 * @param {string} query - The search text as typed.
 * @returns {boolean} True when it matches (always for an empty search).
 */
export function matchesManagedNetworkSearch(row: ManagedNetworkRow, query: string): boolean {
  const needle = normalizeSearch(query);
  if (needle === '' || row.network.name.toLowerCase().includes(needle)) return true;
  return row.scope.kind === 'apGroups' && row.scope.groups.some(group => group.wlanName.toLowerCase().includes(needle));
}

/**
 * Returns the managed rows matching the search, in order.
 * @param {readonly ManagedNetworkRow[]} rows - All rows.
 * @param {string} query - The search text as typed.
 * @returns {ManagedNetworkRow[]} The matching rows.
 */
export function filterManagedNetworkRows(rows: readonly ManagedNetworkRow[], query: string): ManagedNetworkRow[] {
  return rows.filter(row => matchesManagedNetworkSearch(row, query));
}

/**
 * Finds the network a key designates, only in the key's own namespace: an
 * id key the network with that id; a name key the ONE network with that
 * name (a cross-link or a selection made on the 14a view names a network;
 * with several of that name none is picked — the same rule as a cross-link,
 * networkLinkTarget() in networks-view.ts). An id never matches a name, nor
 * a name an id.
 * @param {readonly ManagedNetwork[]} networks - The managed networks.
 * @param {NetworkKey | null} key - The key, or null.
 * @returns {ManagedNetwork | null} The network, or null.
 */
export function findManagedNetwork(networks: readonly ManagedNetwork[], key: NetworkKey | null): ManagedNetwork | null {
  if (key === null) return null;
  if (key.kind === 'id') {
    return networks.find(network => network.id === key.value) ?? null;
  }
  const named = networks.filter(network => network.name === key.value);
  return named.length === 1 ? named[0] : null;
}

/**
 * The key the view's selection is resolved by on the managed list: its id
 * when one is held (selected there, or waiting from the Back history), else
 * its name (a cross-link or the 14a view's selection), else none.
 * @param {string | null} selectedId - The selected network's id, or null.
 * @param {string | null} selectedName - The selected network's name, or null.
 * @returns {NetworkKey | null} The key, or null.
 */
export function networkSelectionKey(selectedId: string | null, selectedName: string | null): NetworkKey | null {
  if (selectedId !== null) return { kind: 'id', value: selectedId };
  return selectedName === null ? null : { kind: 'name', value: selectedName };
}

/**
 * Resolves the view's selection on the managed list: by its id when one is
 * held (a network that is gone is not replaced by another, not even by its
 * namesake), else by its name (the ONE network with that name).
 * @param {readonly ManagedNetwork[]} networks - The managed networks.
 * @param {string | null} selectedId - The selected network's id, or null.
 * @param {string | null} selectedName - The selected network's name, or null.
 * @returns {ManagedNetwork | null} The selected network, or null.
 */
export function resolveManagedSelection(networks: readonly ManagedNetwork[], selectedId: string | null, selectedName: string | null): ManagedNetwork | null {
  return findManagedNetwork(networks, networkSelectionKey(selectedId, selectedName));
}

// The Back history keeps a view's item as a string (nav-history.ts): the
// Wi-Fi networks view's items carry their key's namespace as a prefix
const HISTORY_ID_PREFIX = 'id:';
const HISTORY_NAME_PREFIX = 'name:';

/**
 * The Back-history item of a network key ("id:<id>" or "name:<name>"), so
 * an id and a name never read as each other once in the history.
 * @param {NetworkKey} key - The key.
 * @returns {string} The item.
 */
export function networkHistoryItem(key: NetworkKey): string {
  return (key.kind === 'id' ? HISTORY_ID_PREFIX : HISTORY_NAME_PREFIX) + key.value;
}

/**
 * The network key of a Back-history item (networkHistoryItem()), or null for
 * an item that is not one.
 * @param {string} item - The item.
 * @returns {NetworkKey | null} The key, or null.
 */
export function parseNetworkHistoryItem(item: string): NetworkKey | null {
  if (item.startsWith(HISTORY_ID_PREFIX)) return { kind: 'id', value: item.slice(HISTORY_ID_PREFIX.length) };
  if (item.startsWith(HISTORY_NAME_PREFIX)) return { kind: 'name', value: item.slice(HISTORY_NAME_PREFIX.length) };
  return null;
}

// ============================================================================
// Value texts (message keys; null = unknown, stated by the caller)
// ============================================================================

/**
 * The message key of a security mode, or null when it is unknown.
 * @param {NetworkSecurity} security - The DTO value.
 * @returns {SecurityKey | null} Its key, or null.
 */
export function securityKey(security: NetworkSecurity): SecurityKey | null {
  return SECURITY_KEYS[security];
}

/**
 * The message key of an enabled state, or null when it is unknown.
 * @param {boolean | null} enabled - The DTO value.
 * @returns {'networkEnabled' | 'networkDisabled' | null} Its key, or null.
 */
export function enabledKey(enabled: boolean | null): 'networkEnabled' | 'networkDisabled' | null {
  if (enabled === null) return null;
  return enabled ? 'networkEnabled' : 'networkDisabled';
}

/**
 * The message key of whether a passphrase is set (never the passphrase:
 * the DTO has none), or null when it is unknown.
 * @param {boolean | null} hasPassphrase - The DTO value.
 * @returns {'passphraseSet' | 'passphraseNone' | null} Its key, or null.
 */
export function passphraseKey(hasPassphrase: boolean | null): 'passphraseSet' | 'passphraseNone' | null {
  if (hasPassphrase === null) return null;
  return hasPassphrase ? 'passphraseSet' : 'passphraseNone';
}

/**
 * The message keys of a band list (the band labels, in the order 2.4 / 5 /
 * 6 GHz), or null when the bands are unknown.
 * @param {NetworkBand[] | null} bands - The DTO value.
 * @returns {NetworkBand[] | null} The keys (the band labels share the band names), or null.
 */
export function bandKeys(bands: NetworkBand[] | null): NetworkBand[] | null {
  if (bands === null || bands.length === 0) return null;
  return BANDS.filter(band => bands.includes(band));
}
