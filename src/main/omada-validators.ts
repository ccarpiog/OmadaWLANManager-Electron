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
 * Validate and normalize the raw device list returned by the controller.
 * Keeps only access points and normalizes optional display fields
 * (missing name, wlanGroup, statusCategory) so later dereferences cannot
 * crash. Required identifiers are strict: an entry that is not an object,
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
    accessPoints.push({
      mac: device.mac,
      name: typeof device.name === 'string' ? device.name : device.mac,
      type: 'ap',
      wlanGroup: typeof device.wlanGroup === 'string' ? device.wlanGroup : '',
      statusCategory: typeof device.statusCategory === 'number' ? device.statusCategory : 0
    });
  } // End of the loop that validates each device entry

  return accessPoints;
} // End of function validateAccessPoints()

/**
 * Validate and normalize the raw WLAN/SSID payload returned by the
 * controller. Normalizes only optional display fields (missing wlanName,
 * missing SSID lists become empty). Required identifiers are strict: an
 * entry that is not an object or lacks a string wlanId makes the whole
 * payload fail as unsupported instead of silently shrinking the list.
 * @param {unknown} result - Raw `result` field of the ssids response.
 * @returns {WlanGroup[]} The normalized list of WLAN groups.
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
