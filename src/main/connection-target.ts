// Connection targets (inbox item I-1b2b1; spec
// autoclaude/processed/10-tplink-cloud-controllers.md, "ConnectionManager
// target"). Pure, Electron-free: which controller ConnectionManager
// (connection-manager.ts) connects to — the configured local controller,
// reached directly, or a controller of the TP-Link cloud account, named by
// its omadacId —, how a target is persisted (`activeController` in the config:
// 'local' or the omadacId, config-model.ts) and the startup resolution with
// its local fallback. Unit-tested in tests/unit/connection-targets.test.ts.

import { isOmadacId } from './cloud-account-model';
import { activeControllerOf, LOCAL_CONTROLLER, StoredConfig } from './config-model';

/** The local controller as a target (the configured URL, reached directly). */
export interface LocalConnectionTarget {
  kind: 'local';
}

/** A controller of the TP-Link cloud account, reached through the Open API cloud route. */
export interface CloudConnectionTarget {
  kind: 'cloud';
  omadacId: string;
}

/** What ConnectionManager connects to. */
export type ConnectionTarget = LocalConnectionTarget | CloudConnectionTarget;

/**
 * Returns a fresh local target (a new object each time, so no caller can
 * share or mutate another one's target).
 * @returns {LocalConnectionTarget} `{kind: 'local'}`.
 */
export function localTarget(): LocalConnectionTarget {
  return { kind: 'local' };
}

/**
 * Validates a target and returns a clean copy of it: `{kind: 'local'}`, or
 * `{kind: 'cloud', omadacId}` with a usable omadacId (isOmadacId(): never
 * 'local' or a reserved object key). Extra keys are not copied.
 * @param {unknown} value - The candidate target.
 * @returns {ConnectionTarget | null} The copy, or null when the value is not a target.
 */
export function normalizeConnectionTarget(value: unknown): ConnectionTarget | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (raw.kind === 'local') {
    return localTarget();
  }
  if (raw.kind === 'cloud' && isOmadacId(raw.omadacId)) {
    return { kind: 'cloud', omadacId: raw.omadacId };
  }
  return null;
} // End of function normalizeConnectionTarget()

/**
 * Tells whether two targets name the same controller.
 * @param {ConnectionTarget} a - One target.
 * @param {ConnectionTarget} b - The other.
 * @returns {boolean} True when both are local, or both the same cloud omadacId.
 */
export function isSameTarget(a: ConnectionTarget, b: ConnectionTarget): boolean {
  if (a.kind === 'local' || b.kind === 'local') {
    return a.kind === b.kind;
  }
  return a.omadacId === b.omadacId;
}

/**
 * The persisted form of a target (`activeController` in the config).
 * @param {ConnectionTarget} target - The target.
 * @returns {string} 'local' (LOCAL_CONTROLLER) or the cloud omadacId.
 */
export function activeControllerValue(target: ConnectionTarget): string {
  return target.kind === 'cloud' ? target.omadacId : LOCAL_CONTROLLER;
}

/**
 * Decides the target the app starts with: the stored cloud controller
 * (`activeController` is an omadacId) only while the cloud credential is
 * usable — a cloud Client ID with a secret available, the session-only
 * fallback included (config-model.ts cloudCredentialsOf() not null) —, else
 * the local controller. `activeController` survives a dropped or undecryptable
 * credential (config-model.ts), so the fallback is decided here, never by
 * deleting the stored choice. Pure; the startup path does not call it yet
 * (phase I-1b2b2 wires it).
 * @param {StoredConfig} config - The stored config.
 * @param {boolean} cloudCredentialUsable - Whether the cloud credential is usable now.
 * @returns {ConnectionTarget} The target to start with.
 */
export function resolveStartupTarget(config: StoredConfig, cloudCredentialUsable: boolean): ConnectionTarget {
  const active = activeControllerOf(config);
  if (active === LOCAL_CONTROLLER || cloudCredentialUsable !== true) {
    return localTarget();
  }
  return { kind: 'cloud', omadacId: active };
}
