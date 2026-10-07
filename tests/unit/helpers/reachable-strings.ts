// Test helper: lists every string value reachable from an object through its
// own properties, its PRIVATE class fields (#…) and its internal slots (e.g.
// a promise's [[PromiseResult]]), using the V8 inspector of the test process
// itself (node:inspector/promises; no --inspect flag needed). util.inspect()
// and JSON.stringify() never show private fields, so this is how a test proves
// that an object no longer references a secret value (e.g. a closed Open API
// client and its bearer tokens). Functions and prototypes are not walked;
// properties whose name matches `skipNames` (e.g. an injected transport that
// records requests) are skipped.

import type { Runtime } from 'node:inspector';
import { Session } from 'node:inspector/promises';

// How deep the walk follows object references (the objects under test are shallow)
const MAX_DEPTH = 8;

// Runtime.getProperties also returns `privateProperties` (the #fields) at
// runtime; @types/node's GetPropertiesReturnType does not declare it
type PropertiesWithPrivate = Runtime.GetPropertiesReturnType & {
  privateProperties?: Array<{ name: string; value?: Runtime.RemoteObject }>;
};

/**
 * Lists the string values reachable from `target` (see the header).
 * @param {object} target - The object to inspect.
 * @param {RegExp} [skipNames] - Property names (private ones with their '#') not to follow.
 * @returns {Promise<string[]>} The reachable strings, in walk order.
 */
export async function reachableStrings(target: object, skipNames: RegExp = /^#?transport$/i): Promise<string[]> {
  const session = new Session();
  session.connect();
  const holder = globalThis as Record<string, unknown>;
  holder.__reachableStringsTarget = target;
  const found: string[] = [];
  const seen = new Set<string>();

  /**
   * Walks one remote object: collects its string values and follows its
   * object values (own, private and internal properties).
   * @param {string} objectId - The inspector's id of the object.
   * @param {number} depth - Current depth.
   * @returns {Promise<void>}
   */
  const walk = async (objectId: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || seen.has(objectId)) {
      return;
    }
    seen.add(objectId);
    const properties: PropertiesWithPrivate = await session.post('Runtime.getProperties', { objectId, ownProperties: true });
    const entries: Array<{ name: string; value?: Runtime.RemoteObject }> = [
      ...properties.result,
      ...(properties.privateProperties ?? []),
      ...(properties.internalProperties ?? [])
    ];
    for (const entry of entries) {
      const value = entry.value;
      if (!value || skipNames.test(entry.name) || entry.name === '[[Prototype]]' || entry.name === '__proto__') {
        continue;
      }
      if (value.type === 'string' && typeof value.value === 'string') {
        found.push(value.value);
      } else if (value.type === 'object' && value.objectId) {
        await walk(value.objectId, depth + 1);
      }
    } // End of the loop over the object's properties
  }; // End of function walk()

  try {
    const evaluated = await session.post('Runtime.evaluate', { expression: 'globalThis.__reachableStringsTarget' });
    if (evaluated.result.objectId) {
      await walk(evaluated.result.objectId, 0);
    }
    return found;
  } finally {
    delete holder.__reachableStringsTarget;
    session.disconnect();
  }
} // End of function reachableStrings()
