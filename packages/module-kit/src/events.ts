import { ModuleContractError } from './contract.ts';
import { namespaceOf } from './manifest.ts';

/**
 * Core event contract (PRD G-17, extension point 9).
 *
 * The event list and payload shapes ARE the contract: removing an event or changing a
 * payload is a breaking change governed by `engines.core` (N-6). Modules subscribe through
 * `hooks.ts`; core emits after the action has succeeded. A failing hook is logged and never
 * fails the action that emitted it (G-7).
 */

export interface CoreEventPayloads {
  /** A user account was created. */
  'user.created': { userId: string; clientId: string | null };
  /** A user account was soft-deleted. */
  'user.deleted': { userId: string; clientId: string | null };
  /** The active tenant of a session changed. */
  'tenant.switched': { userId: string; fromClientId: string | null; toClientId: string };
  /** A configuration value was saved (per tenant or global). */
  'config.saved': { section: string; key: string; clientId: string | null };
  /** A module was enabled or disabled for a tenant. */
  'module.toggled': { module: string; clientId: string; enabled: boolean };
  /** In-app notifications were written for these users (J-4); modules may fan out (webhook, push). */
  'notification.created': { clientId: string; type: string; userIds: readonly string[] };
  /** A queue job attempt started (P2, `queue_jobs`). */
  'job.started': {
    jobId: string;
    name: string;
    clientId: string | null;
    attempt: number;
    maxAttempts: number;
  };
  /** A queue job attempt ended; `status` is what the row became. */
  'job.finished': {
    jobId: string;
    name: string;
    clientId: string | null;
    attempt: number;
    maxAttempts: number;
    status: 'done' | 'retried' | 'dead';
    durationMs: number;
    error: string | null;
  };
  /** Diagnostic event used by tests and the M0 gate; never emitted in production flows. */
  'system.ping': { at: string; note?: string };
}

export type CoreEventName = keyof CoreEventPayloads;

/** Runtime list, kept in sync with the interface above; `modules:sync` validates hook names against it. */
export const CORE_EVENTS = [
  'user.created',
  'user.deleted',
  'tenant.switched',
  'config.saved',
  'module.toggled',
  'notification.created',
  'job.started',
  'job.finished',
  'system.ping',
] as const satisfies readonly CoreEventName[];

/** What a hook receives besides the payload. */
export interface HookContext {
  readonly event: CoreEventName;
  readonly requestId: string | null;
  readonly emittedAt: Date;
}

export type HookHandler<E extends CoreEventName> = (
  payload: CoreEventPayloads[E],
  ctx: HookContext,
) => void | Promise<void>;

export type HookMap = { readonly [E in CoreEventName]?: HookHandler<E> };

export interface ModuleHooks {
  readonly module: string;
  readonly ns: string;
  readonly handlers: HookMap;
}

/** Declare the core events a module listens to (`hooks.ts`). Unknown event names fail here and at sync. */
export function defineHooks(moduleName: string, handlers: HookMap): ModuleHooks {
  const ns = namespaceOf(moduleName);
  for (const name of Object.keys(handlers)) {
    if (!(CORE_EVENTS as readonly string[]).includes(name)) {
      throw new ModuleContractError(
        `modul ${moduleName}: event "${name}" tidak dikenal (event core: ${CORE_EVENTS.join(', ')})`,
      );
    }
    if (typeof handlers[name as CoreEventName] !== 'function') {
      throw new ModuleContractError(`modul ${moduleName}: handler "${name}" bukan fungsi`);
    }
  }
  return { module: moduleName, ns, handlers };
}
