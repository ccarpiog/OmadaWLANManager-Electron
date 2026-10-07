// The cloud side of ConnectionManager's targets (inbox item I-1b2b1; spec
// autoclaude/processed/10-tplink-cloud-controllers.md, "Architecture";
// docs/omada-cloud-openapi.md §12). Electron-free: the cloud access and the
// cloud transport are injected (index.ts passes CloudAccessService and the
// I-1a cloud transport — its own Electron session, the origin allowlist), so
// the unit tests drive it on fixtures over a fake transport
// (tests/unit/connection-targets.test.ts).
//
// A cloud target's connect asks lookupController() for the omadacId:
// - a FRESH organization entry is read (CloudAccessService.findOrganization():
//   the organization list read now, the account token reused); an unusable
//   credential ('notConfigured'), an account failure (its stable code), a
//   truncated organization list ('listIncomplete') or an unknown omadacId
//   ('unknownController') refuses it;
// - a known but non-connectable organization refuses it with its DTO reason
//   (cloudControllerReason(): notController, incompleteEntry,
//   unsupportedHost, versionUnknown, versionTooOld, offline);
// - otherwise the session factory is offered: `new ControllerSession({kind:
//   'cloud', omadacId, name, orgVersion, createOpenApiClient})` whose clients
//   are `new OpenApiClient({route: 'cloud', target, tokenProvider: account,
//   throttle: account.throttle, transport})`, `target` from
//   cloudControllerTarget() — so every request goes to the allowlisted
//   serverHost's tunnel of this organization, with the account's token and
//   the credential's shared throttle. Nothing is sent before connect().
// Refusals carry codes only (never a deviceId, serverHost, secret or token);
// the factory also names the values a session failure is scrubbed of by
// value (the routing identifiers and the account's live secrets).

import type { CloudAccessService } from './cloud-access';
import { cloudControllerReason, cloudControllerTarget } from './cloud-account-model';
import type { CloudControllerLookup } from './connection-manager';
import { ControllerSession } from './controller-session';
import type { OmadaTransport } from './omada-transport';
import { CloudOpenApiClientOptions, OpenApiClient } from './openapi-client';

/** Options of createCloudControllerLookup(). */
export interface CloudControllerLookupOptions {
  // The cloud access of the saved credential (production: CloudAccessService)
  access: Pick<CloudAccessService, 'findOrganization'>;
  // The cloud transport (production: the I-1a cloud net transport)
  transport: OmadaTransport;
  // The pause between a move's re-reads (tests inject a fake)
  sleep?: (ms: number) => Promise<void>;
  // Creates each cloud-route client (tests wrap it to observe the clients)
  createOpenApiClient?(options: CloudOpenApiClientOptions): OpenApiClient;
}

/**
 * The values a cloud session failure is scrubbed of by value: the
 * organization's deviceId, its serverHost origin and bare host (the cloud
 * route already scrubs them; this is the second layer).
 * @param {{ deviceId: string; serverOrigin: string }} target - The cloud route target.
 * @returns {string[]} The values.
 */
function routingValues(target: { deviceId: string; serverOrigin: string }): string[] {
  const values = [target.deviceId, target.serverOrigin];
  try {
    values.push(new URL(target.serverOrigin).host);
  } catch {
    // An allowlisted origin always parses; nothing more to scrub otherwise
  }
  return values;
}

/**
 * Builds ConnectionManager's CloudConnectionDeps.lookupController() (see the
 * header). The returned function never rejects.
 * @param {CloudControllerLookupOptions} options - The cloud access, transport and test hooks.
 * @returns {(omadacId: string) => Promise<CloudControllerLookup<ControllerSession>>} The lookup.
 */
export function createCloudControllerLookup(options: CloudControllerLookupOptions): (omadacId: string) => Promise<CloudControllerLookup<ControllerSession>> {
  const createClient = options.createOpenApiClient ?? ((clientOptions: CloudOpenApiClientOptions) => new OpenApiClient(clientOptions));

  /**
   * Looks the omadacId up in a fresh organization list and offers its session.
   * @param {string} omadacId - The cloud target's omadacId.
   * @returns {Promise<CloudControllerLookup<ControllerSession>>} The factory, or a code.
   */
  return async (omadacId: string): Promise<CloudControllerLookup<ControllerSession>> => {
    let found: Awaited<ReturnType<CloudAccessService['findOrganization']>>;
    try {
      found = await options.access.findOrganization(omadacId);
    } catch {
      return { ok: false, code: 'networkError', diagnostic: 'unexpected failure' };
    }
    if (!found.success) {
      return found.diagnostic === undefined ? { ok: false, code: found.error } : { ok: false, code: found.error, diagnostic: found.diagnostic };
    }
    const { organization, account } = found;
    const refusal = cloudControllerReason(organization);
    const target = cloudControllerTarget(organization);
    if (refusal !== null || target === null) {
      return { ok: false, code: refusal ?? 'incompleteEntry' };
    }
    return {
      ok: true,
      /**
       * The values a failure of this session is scrubbed of by value.
       * @returns {string[]} The routing identifiers and the account's live secrets.
       */
      secrets: () => [...routingValues(target), ...account.liveSecrets()],
      /**
       * Builds the (not yet connected) Open-API-only session.
       * @returns {ControllerSession} The cloud session.
       */
      create: () =>
        new ControllerSession({
          kind: 'cloud',
          omadacId: organization.omadacId,
          name: organization.name,
          orgVersion: organization.version,
          createOpenApiClient: () => createClient({ route: 'cloud', target, tokenProvider: account, throttle: account.throttle, transport: options.transport }),
          sleep: options.sleep
        })
    };
  }; // End of the lookup function
} // End of function createCloudControllerLookup()
