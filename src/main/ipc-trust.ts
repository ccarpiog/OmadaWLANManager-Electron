// Trusted IPC registration (docs/management-design.md §3, "New IPC channels"
// and "Redaction"). Pure: the ipcMain-like registry, the sender check and the
// stored-secret source are injected, so the module never imports Electron and
// is unit-tested in tests/unit/ipc-surface.test.ts. index.ts registers EVERY
// invoke channel through the registrar built here (that test also proves it
// by reading index.ts), so:
// - no handler body runs before the sender check: a call from any frame but
//   the app's own renderer is rejected with UNTRUSTED_SENDER_MESSAGE;
// - a handler failure crosses to the renderer — and into Electron's own
//   "Error occurred in handler for '<channel>'" console line — only as a
//   redacted message (sanitizeIpcError()): redactText() plus every known
//   secret scrubbed by value, i.e. the stored controller password and Client
//   Secret (getStoredSecrets) and the secrets the call itself carried (string
//   values under sensitive keys of its arguments, e.g. a typed passphrase);
// - one channel cannot be registered twice.

import { isSensitiveKey, redactErrorMessage } from './redact';

// The rejection of a call from an untrusted frame (fixed text, not user-facing:
// the renderer maps rejections to generic i18n messages)
export const UNTRUSTED_SENDER_MESSAGE = 'IPC call rejected: untrusted sender frame';

// How deep argumentSecrets() walks into the arguments (the payloads are flat
// objects; anything deeper is not a payload this app sends)
const MAX_SECRET_DEPTH = 4;

/**
 * The part of Electron's ipcMain the registrar needs.
 * @template E The invoke event type.
 */
export interface IpcHandleRegistry<E> {
  // `any[]` mirrors Electron's own listener type so ipcMain fits structurally
  handle(channel: string, listener: (event: E, ...args: any[]) => unknown): void;
}

/**
 * A channel handler as index.ts writes it: the arguments arrive untyped and
 * are shape-checked inside the handler.
 * @template E The invoke event type.
 */
export type TrustedHandler<E> = (event: E, ...args: unknown[]) => unknown;

/**
 * The registrar index.ts registers every channel with.
 * @template E The invoke event type.
 */
export interface TrustedIpcRegistrar<E> {
  handle(channel: string, handler: TrustedHandler<E>): void;
  // The channels registered so far, in registration order
  readonly channels: readonly string[];
}

/**
 * Lists the secret values an IPC call carries: every non-empty string under a
 * sensitive key (isSensitiveKey(): `password`, `clientSecret`, `passphrase`,
 * …) anywhere in its arguments, so a failure that echoes one of them is
 * scrubbed by value even when no key names it.
 * @param {readonly unknown[]} args - The call's arguments.
 * @returns {string[]} The secret values found.
 */
export function argumentSecrets(args: readonly unknown[]): string[] {
  const secrets: string[] = [];

  /**
   * Collects the secrets of one value.
   * @param {unknown} value - The value.
   * @param {number} depth - Nesting depth.
   */
  const walk = (value: unknown, depth: number): void => {
    if (value === null || typeof value !== 'object' || depth > MAX_SECRET_DEPTH) {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, depth + 1));
      return;
    }
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key) && typeof item === 'string' && item.length > 0) {
        secrets.push(item);
      } else {
        walk(item, depth + 1);
      }
    }
  }; // End of function walk()

  args.forEach((arg) => walk(arg, 0));
  return secrets;
} // End of function argumentSecrets()

/**
 * Turns a handler failure into the Error that crosses the IPC boundary: a new
 * Error carrying only the redacted message (redactErrorMessage() with the
 * known secrets scrubbed by value) — never the original object, its stack or
 * any other property.
 * @param {unknown} error - The thrown value.
 * @param {readonly (string | null | undefined)[]} knownSecrets - Secret values to scrub.
 * @returns {Error} The sanitized error.
 */
export function sanitizeIpcError(error: unknown, knownSecrets: readonly (string | null | undefined)[]): Error {
  return new Error(redactErrorMessage(error, knownSecrets));
}

/**
 * Builds the registrar for the invoke channels (see the header).
 * @template E The invoke event type.
 * @param {IpcHandleRegistry<E>} ipc - Electron's ipcMain (a fake in the tests).
 * @param {(event: E) => boolean} isTrusted - The sender check.
 * @param {() => readonly (string | null | undefined)[]} getStoredSecrets - The
 *   stored secrets to scrub from a failure (read only when a handler fails;
 *   a throwing source counts as none).
 * @returns {TrustedIpcRegistrar<E>} The registrar.
 */
export function createTrustedIpcRegistrar<E>(
  ipc: IpcHandleRegistry<E>,
  isTrusted: (event: E) => boolean,
  getStoredSecrets: () => readonly (string | null | undefined)[]
): TrustedIpcRegistrar<E> {
  const channels: string[] = [];

  /**
   * The stored secrets, or none when reading them fails.
   * @returns {readonly (string | null | undefined)[]} The secrets.
   */
  const storedSecrets = (): readonly (string | null | undefined)[] => {
    try {
      return getStoredSecrets();
    } catch {
      return [];
    }
  };

  /**
   * Registers one channel behind the sender check and the error sanitizer.
   * @param {string} channel - The channel name.
   * @param {TrustedHandler<E>} handler - The handler.
   * @throws {Error} When the channel is registered already.
   */
  const handle = (channel: string, handler: TrustedHandler<E>): void => {
    if (channels.includes(channel)) {
      throw new Error(`IPC channel registered twice: ${channel}`);
    }
    channels.push(channel);
    ipc.handle(channel, async (event: E, ...args: unknown[]) => {
      if (!isTrusted(event)) {
        throw new Error(UNTRUSTED_SENDER_MESSAGE);
      }
      try {
        return await handler(event, ...args);
      } catch (error) {
        throw sanitizeIpcError(error, [...storedSecrets(), ...argumentSecrets(args)]);
      }
    }); // End of the wrapped listener
  }; // End of function handle()

  return {
    handle,
    get channels(): readonly string[] {
      return [...channels];
    }
  };
} // End of function createTrustedIpcRegistrar()
