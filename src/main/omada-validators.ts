// Runtime validators for Omada internal-API response payloads (todo.md 3.13).
// Pure (no Electron), so each one is unit-tested against JSON fixtures
// (tests/unit/omada-validators.test.ts, tests/fixtures/validators/). Every
// validator is strict about required identifiers — an unexpected shape fails
// with an explicit "Unsupported API response (...)" error instead of silently
// shrinking a list — and normalizes only optional display fields.

import { AccessPoint, SiteInfo, Ssid, WlanGroup } from '../shared/types';

/**
 * One validated page of the authorized-site listing (see validateSitePage()).
 */
export interface SitePage {
  // Validated entries of this page, in response order (NOT deduplicated — the
  // caller deduplicates across pages)
  sites: SiteInfo[];
  // Raw number of entries on the page (drives the pagination walk)
  entryCount: number;
  // Total-entry metadata (`totalRows`), or null when absent or not a sane
  // non-negative finite number
  totalRows: number | null;
}

/**
 * One entry of the authoritative group list (internal `GET setting/wlans`,
 * see validateGroupList()): the group id and its display name.
 */
export interface GroupListEntry {
  id: string;
  name: string;
}

/**
 * Result of joinGroupsWithSsids(): the joined groups, in group-list order, and
 * the ids of the `setting/ssids` entries that matched no listed group (they
 * were left out; the caller may log them).
 */
export interface GroupJoinResult {
  groups: WlanGroup[];
  ignoredSsidGroupIds: string[];
}

/**
 * Tells whether a group-payload entry belongs to access points. Group payloads
 * (`setting/ssids` entries carry it; see docs/omada-6.3-api-findings.md) may
 * tag each entry with a `deviceType`: only the AP type ('ap', in any letter
 * case) counts. An entry without the field (absent or null) counts as an AP
 * entry, because these endpoints have always served AP groups and older
 * payloads may not carry the tag.
 * @param {Record<string, unknown>} entry - One payload entry (an object).
 * @returns {boolean} True when the entry is an access-point entry.
 */
function isApEntry(entry: Record<string, unknown>): boolean {
  const deviceType = entry.deviceType;
  if (deviceType === undefined || deviceType === null) {
    return true;
  }
  return typeof deviceType === 'string' && deviceType.toLowerCase() === 'ap';
}

/**
 * Tells whether a raw value is a usable client count: a non-negative safe
 * integer.
 * @param {unknown} value - The raw `clientNum` value of a device entry.
 * @returns {value is number} True when the value can be shown as a count.
 */
function isClientCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Validate and normalize the raw device list returned by the controller.
 * Keeps only access points and normalizes optional display fields
 * (missing name, wlanGroup, statusCategory; `clientNum` is kept only when it
 * is a non-negative integer, otherwise left absent) so later dereferences
 * cannot crash. Required identifiers are strict: an entry that is not an object,
 * lacks a string `type`, or is an AP without a MAC address makes the
 * whole payload fail as unsupported instead of silently shrinking the
 * list to empty.
 * @param {unknown} result - Raw `result` field of the devices response.
 * @returns {AccessPoint[]} The normalized list of access points.
 * @throws {Error} When the payload shape is unsupported.
 */
export function validateAccessPoints(result: unknown): AccessPoint[] {
  if (!Array.isArray(result)) {
    throw new Error('Unsupported API response (devices)');
  }

  const accessPoints: AccessPoint[] = [];
  for (const entry of result) {
    if (entry === null || typeof entry !== 'object') {
      throw new Error('Unsupported API response (devices)');
    }
    const device = entry as Record<string, unknown>;
    if (typeof device.type !== 'string') {
      // Without a device type we cannot even tell APs apart
      throw new Error('Unsupported API response (devices)');
    }
    if (device.type !== 'ap') {
      continue; // Only access points are relevant
    }
    if (typeof device.mac !== 'string' || device.mac === '') {
      // The MAC is the AP's required identifier
      throw new Error('Unsupported API response (devices)');
    }
    const accessPoint: AccessPoint = {
      mac: device.mac,
      name: typeof device.name === 'string' ? device.name : device.mac,
      type: 'ap',
      wlanGroup: typeof device.wlanGroup === 'string' ? device.wlanGroup : '',
      statusCategory: typeof device.statusCategory === 'number' ? device.statusCategory : 0
    };
    // Optional display field: the number of connected clients (`clientNum`,
    // as the Open API device list documents it; not verified live on the
    // internal list — design spec D4). Kept only as a non-negative safe
    // integer; any other value leaves the field absent (unknown)
    if (isClientCount(device.clientNum)) {
      accessPoint.clientNum = device.clientNum;
    }
    accessPoints.push(accessPoint);
  } // End of the loop that validates each device entry

  return accessPoints;
} // End of function validateAccessPoints()

/**
 * Validate and normalize the raw `setting/ssids` payload: one entry per group
 * that has Wi-Fi networks, with the group id (`wlanId`), its name and its SSID
 * list (on Omada 6.3+ `wlanId` is the AP-group id, and groups without SSIDs
 * are omitted — see validateGroupList() for the complete list). Entries whose
 * `deviceType` is not the AP type are ignored (isApEntry()). Normalizes only
 * optional display fields (missing wlanName, missing SSID lists become empty).
 * Required identifiers are strict: an entry that is not an object, or an AP
 * entry without a string wlanId, makes the whole payload fail as unsupported
 * instead of silently shrinking the list.
 * @param {unknown} result - Raw `result` field of the ssids response.
 * @returns {WlanGroup[]} The normalized groups with their SSID names.
 * @throws {Error} When the payload shape is unsupported.
 */
export function validateWlanGroups(result: unknown): WlanGroup[] {
  const ssids = result !== null && typeof result === 'object'
    ? (result as Record<string, unknown>).ssids
    : undefined;
  if (!Array.isArray(ssids)) {
    throw new Error('Unsupported API response (WLANs)');
  }

  const wlanGroups: WlanGroup[] = [];
  for (const entry of ssids) {
    if (entry === null || typeof entry !== 'object') {
      throw new Error('Unsupported API response (WLANs)');
    }
    const wlan = entry as Record<string, unknown>;
    if (!isApEntry(wlan)) {
      continue; // Not an access-point group (e.g. a gateway's own Wi-Fi)
    }
    if (typeof wlan.wlanId !== 'string' || wlan.wlanId === '') {
      // wlanId is the group's required identifier
      throw new Error('Unsupported API response (WLANs)');
    }

    // Normalize the SSID list: absent/invalid lists become empty arrays
    const rawSsidList = Array.isArray(wlan.ssidList) ? wlan.ssidList : [];
    const ssidList: Ssid[] = [];
    for (const rawSsid of rawSsidList) {
      const ssidName = rawSsid !== null && typeof rawSsid === 'object'
        ? (rawSsid as Record<string, unknown>).ssidName
        : undefined;
      ssidList.push({ ssidName: typeof ssidName === 'string' ? ssidName : '' });
    } // End of the loop that normalizes the SSID list

    wlanGroups.push({
      wlanId: wlan.wlanId,
      wlanName: typeof wlan.wlanName === 'string' ? wlan.wlanName : '',
      ssidList
    });
  } // End of the loop that validates each WLAN entry

  return wlanGroups;
} // End of function validateWlanGroups()

/**
 * Validate the authoritative group list (`setting/wlans`): `result.data` must
 * be an array of objects, and every access-point entry needs a non-empty
 * string `id`; otherwise the controller speaks a shape we don't support. On
 * Omada 6.3+ this is the complete AP-group list, including groups without
 * SSIDs (docs/omada-6.3-api-findings.md). Entries whose `deviceType` is not
 * the AP type are ignored (isApEntry()); a repeated id keeps its first entry.
 * Only the display name is normalized (a missing one becomes ''); every other
 * field (default flag, per-band capacity, ...) is left out of the result.
 * @param {unknown} result - Raw `result` field of the wlans response.
 * @returns {GroupListEntry[]} The groups, in response order.
 * @throws {Error} When the payload shape is unsupported.
 */
export function validateGroupList(result: unknown): GroupListEntry[] {
  const data = result !== null && typeof result === 'object'
    ? (result as Record<string, unknown>).data
    : undefined;
  if (!Array.isArray(data)) {
    throw new Error('Unsupported API response (groups)');
  }

  const groups: GroupListEntry[] = [];
  const seenIds = new Set<string>();
  for (const entry of data) {
    if (entry === null || typeof entry !== 'object') {
      throw new Error('Unsupported API response (groups)');
    }
    const group = entry as Record<string, unknown>;
    if (!isApEntry(group)) {
      continue; // Not an access-point group
    }
    if (typeof group.id !== 'string' || group.id === '') {
      // The id is the group's required identifier (the AP move sends it)
      throw new Error('Unsupported API response (groups)');
    }
    if (seenIds.has(group.id)) {
      continue; // Deduplicate: keep the first occurrence of each id
    }
    seenIds.add(group.id);
    groups.push({ id: group.id, name: typeof group.name === 'string' ? group.name : '' });
  } // End of the loop that validates each group-list entry

  return groups;
} // End of function validateGroupList()

/**
 * Outer-joins the SSID names of `setting/ssids` (validateWlanGroups() output)
 * onto the authoritative group list of `setting/wlans` (validateGroupList()
 * output). Every listed group is kept — including the groups without SSIDs,
 * which `setting/ssids` omits — with the SSID names of every `setting/ssids`
 * entry that carries its id, in payload order. A `setting/ssids` entry whose
 * id is not in the list is left out and reported in `ignoredSsidGroupIds`:
 * the list is authoritative, and an AP can only be moved into a group it
 * contains. The name comes from the list; a blank one falls back to the name
 * `setting/ssids` reports for the same id. The result shares no objects with
 * the inputs.
 * @param {GroupListEntry[]} groupList - The validated group list.
 * @param {WlanGroup[]} ssidGroups - The validated `setting/ssids` groups.
 * @returns {GroupJoinResult} The joined groups and the ignored ids.
 */
export function joinGroupsWithSsids(groupList: GroupListEntry[], ssidGroups: WlanGroup[]): GroupJoinResult {
  const listedIds = new Set(groupList.map((group) => group.id));
  const ssidGroupsById = new Map<string, WlanGroup[]>();
  const ignoredSsidGroupIds: string[] = [];

  for (const ssidGroup of ssidGroups) {
    if (!listedIds.has(ssidGroup.wlanId)) {
      if (!ignoredSsidGroupIds.includes(ssidGroup.wlanId)) {
        ignoredSsidGroupIds.push(ssidGroup.wlanId);
      }
      continue;
    }
    const matches = ssidGroupsById.get(ssidGroup.wlanId) ?? [];
    matches.push(ssidGroup);
    ssidGroupsById.set(ssidGroup.wlanId, matches);
  } // End of the loop that indexes the setting/ssids entries by group id

  const groups = groupList.map((group): WlanGroup => {
    const matches = ssidGroupsById.get(group.id) ?? [];
    const fallbackName = matches.find((match) => match.wlanName !== '')?.wlanName ?? '';
    return {
      wlanId: group.id,
      wlanName: group.name !== '' ? group.name : fallbackName,
      ssidList: matches.flatMap((match) => match.ssidList.map((ssid) => ({ ssidName: ssid.ssidName })))
    };
  });

  return { groups, ignoredSsidGroupIds };
} // End of function joinGroupsWithSsids()

/**
 * Validate one page of the paginated authorized-site listing: `result.data`
 * must be an array of objects with a non-empty string id, otherwise the
 * controller speaks a shape we don't support. A missing/empty name falls back
 * to the id (display-only field). The `totalRows` metadata (the field the
 * Omada v2 paged responses use) is honored only when it is a sane number.
 * @param {unknown} result - Raw `result` field of one sites response.
 * @returns {SitePage} The page's validated entries plus pagination metadata.
 * @throws {Error} When the payload shape is unsupported.
 */
export function validateSitePage(result: unknown): SitePage {
  const data = result !== null && typeof result === 'object'
    ? (result as Record<string, unknown>).data
    : undefined;
  if (!Array.isArray(data)) {
    throw new Error('Unsupported API response (sites)');
  }

  const sites: SiteInfo[] = [];
  for (const entry of data) {
    if (entry === null || typeof entry !== 'object') {
      throw new Error('Unsupported API response (sites)');
    }
    const site = entry as Record<string, unknown>;
    if (typeof site.id !== 'string' || site.id === '') {
      // The id is the site's required identifier; a missing one means the
      // controller speaks a shape we don't support
      throw new Error('Unsupported API response (sites)');
    }
    sites.push({
      id: site.id,
      // The name is display-only: normalize a missing one to the id
      name: typeof site.name === 'string' && site.name !== '' ? site.name : site.id
    });
  } // End of the loop that validates each site entry of the page

  const rawTotal = (result as Record<string, unknown>).totalRows;
  const totalRows = typeof rawTotal === 'number' && Number.isFinite(rawTotal) && rawTotal >= 0
    ? rawTotal
    : null;

  return { sites, entryCount: data.length, totalRows };
} // End of function validateSitePage()
