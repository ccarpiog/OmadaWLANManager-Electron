// Tests for the cross-navigation history helpers (src/renderer/nav-history.ts,
// a DOM-free module): link kinds and the view each opens, "already there"
// detection, push with a cap, pop (a round trip restores each location in
// reverse order), reconciling the history with newly loaded data (gone items
// dropped, labels refreshed, neighbours at one place collapsed, nothing on
// top at the current place), and scroll-offset sanitizing.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  isCurrentLocation,
  isLinkKind,
  MAX_HISTORY,
  popLocation,
  pushLocation,
  reconcileHistory,
  sanitizeScroll,
  viewForLink,
  type NavLocation,
} from '../../src/renderer/nav-history';

/**
 * Builds a location for the tests.
 * @param {NavLocation['view']} view - The view.
 * @param {string | null} item - The item it shows.
 * @param {Partial<NavLocation>} [extra] - Other fields to set.
 * @returns {NavLocation} The location.
 */
function location(view: NavLocation['view'], item: string | null, extra: Partial<NavLocation> = {}): NavLocation {
  return { view, item, itemLabel: item, search: '', listScroll: 0, detailScroll: 0, focusLink: null, ...extra };
}

describe('link kinds', () => {
  test('only ap, group and network are link kinds', () => {
    assert.equal(isLinkKind('ap'), true);
    assert.equal(isLinkKind('group'), true);
    assert.equal(isLinkKind('network'), true);
    for (const value of ['AP', 'site', '', undefined, null, 1]) {
      assert.equal(isLinkKind(value), false, String(value));
    }
  });

  test('each kind opens its view', () => {
    assert.equal(viewForLink('ap'), 'accessPoints');
    assert.equal(viewForLink('group'), 'groups');
    assert.equal(viewForLink('network'), 'networks');
  });

  test('a link to the item already shown in its view is the current location', () => {
    assert.equal(isCurrentLocation(location('groups', 'g1'), { kind: 'group', target: 'g1' }), true);
    assert.equal(isCurrentLocation(location('groups', 'g1'), { kind: 'group', target: 'g2' }), false);
    assert.equal(isCurrentLocation(location('networks', 'g1'), { kind: 'group', target: 'g1' }), false);
    assert.equal(isCurrentLocation(location('accessPoints', null), { kind: 'ap', target: 'AA-00-00-00-00-01' }), false);
  });
}); // End of the describe block for link kinds

describe('history', () => {
  test('a round trip (AP details -> group -> network -> Back -> Back) restores each location in reverse order', () => {
    const apDetails = location('accessPoints', 'AA-00-00-00-00-01', { listScroll: 120, focusLink: { kind: 'group', target: 'g1' } });
    const groupView = location('groups', 'g1', { search: 'def', detailScroll: 40, focusLink: { kind: 'network', target: 'Casa' } });
    let history = pushLocation([], apDetails);
    history = pushLocation(history, groupView);

    const first = popLocation(history);
    assert.deepEqual(first.location, groupView);
    const second = popLocation(first.history);
    assert.deepEqual(second.location, apDetails);
    assert.deepEqual(second.history, []);
  });

  test('pop on an empty history returns no location', () => {
    assert.deepEqual(popLocation([]), { location: null, history: [] });
  });

  test('push never mutates its input and keeps at most the cap, dropping the oldest', () => {
    const start = [location('groups', 'a')];
    const next = pushLocation(start, location('groups', 'b'));
    assert.equal(start.length, 1);
    assert.equal(next.length, 2);

    let history: NavLocation[] = [];
    for (let index = 0; index < MAX_HISTORY + 5; index++) {
      history = pushLocation(history, location('networks', `n${index}`));
    }
    assert.equal(history.length, MAX_HISTORY);
    assert.equal(history[0].item, 'n5');
    assert.equal(history[history.length - 1].item, `n${MAX_HISTORY + 4}`);
    assert.deepEqual(pushLocation(history, location('groups', 'x'), 2).map(entry => entry.item), [`n${MAX_HISTORY + 4}`, 'x']);
    assert.equal(pushLocation([], location('groups', 'x'), 0).length, 1, 'a cap below 1 still keeps the new location');
  }); // End of test "push never mutates its input and keeps at most the cap..."

  test('regression (phase 14a review): reconciling after a load drops the locations whose item is gone, keeps item-less ones and refreshes the labels', () => {
    const history = [
      location('accessPoints', 'AA-00-00-00-00-01', { itemLabel: 'Old name' }),
      location('groups', 'gone-group'),
      location('networks', null, { search: 'cas' }),
      location('networks', 'Casa', { listScroll: 30 }),
    ];
    const names: Record<string, string | null> = { 'AA-00-00-00-00-01': 'New name', 'gone-group': null, Casa: 'Casa' };
    const reconciled = reconcileHistory(history, (_view, item) => names[item] ?? null, null);
    assert.deepEqual(reconciled, [
      location('accessPoints', 'AA-00-00-00-00-01', { itemLabel: 'New name' }),
      location('networks', null, { search: 'cas' }),
      location('networks', 'Casa', { listScroll: 30 }),
    ]);
    assert.equal(history.length, 4, 'the input is never mutated');
    assert.equal(history[0].itemLabel, 'Old name');
  }); // End of test "regression (phase 14a review): reconciling after a load drops..."

  test('reconciling: Back offers the newest surviving location ("Back to Casa" once the AP after it is gone)', () => {
    const history = [location('networks', 'Casa'), location('accessPoints', 'AA-00-00-00-00-04')];
    const reconciled = reconcileHistory(history, (_view, item) => (item === 'Casa' ? 'Casa' : null), { view: 'groups', item: 'g1' });
    assert.deepEqual(popLocation(reconciled), { location: location('networks', 'Casa'), history: [] });
  });

  test('reconciling: neighbours left at the same place collapse into the most recent one', () => {
    const older = location('groups', 'g1', { detailScroll: 10, focusLink: { kind: 'ap', target: 'AA-00-00-00-00-04' } });
    const newer = location('groups', 'g1', { detailScroll: 20, focusLink: { kind: 'network', target: 'Casa' } });
    const history = [location('networks', 'Casa'), older, location('accessPoints', 'AA-00-00-00-00-04'), newer];
    const loaded = (_view: NavLocation['view'], item: string): string | null => (item === 'AA-00-00-00-00-04' ? null : item);
    assert.deepEqual(reconcileHistory(history, loaded, null), [location('networks', 'Casa'), newer]);
  });

  test('reconciling: locations on top at the current place are dropped (Back never leads where the user is)', () => {
    const history = [location('networks', 'Casa'), location('groups', 'g1'), location('accessPoints', 'AA-00-00-00-00-04')];
    const loaded = (_view: NavLocation['view'], item: string): string | null => (item === 'AA-00-00-00-00-04' ? null : item);
    assert.deepEqual(reconcileHistory(history, loaded, { view: 'groups', item: 'g1' }), [location('networks', 'Casa')]);
    assert.deepEqual(reconcileHistory(history, loaded, { view: 'groups', item: 'g2' }), [location('networks', 'Casa'), location('groups', 'g1')]);
    assert.deepEqual(reconcileHistory(history, loaded, null), [location('networks', 'Casa'), location('groups', 'g1')]);
  });

  test('reconciling: nothing gone and nowhere current leaves the history as it was; an empty history stays empty', () => {
    const history = [location('accessPoints', 'AA-00-00-00-00-01'), location('groups', 'g1'), location('networks', 'Casa')];
    assert.deepEqual(reconcileHistory(history, (_view, item) => item, { view: 'accessPoints', item: null }), history);
    assert.deepEqual(reconcileHistory([], () => null, { view: 'groups', item: null }), []);
  });

  test('scroll offsets are kept only as finite non-negative numbers', () => {
    assert.equal(sanitizeScroll(42.5), 42.5);
    assert.equal(sanitizeScroll(0), 0);
    assert.equal(sanitizeScroll(-3), 0);
    assert.equal(sanitizeScroll(Number.NaN), 0);
    assert.equal(sanitizeScroll(Number.POSITIVE_INFINITY), 0);
  });
}); // End of the describe block for history
