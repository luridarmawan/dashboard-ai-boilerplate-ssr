import type {
  CoreEventName,
  CoreEventPayloads,
  HookContext,
  HookHandler,
  ModuleHooks,
} from '@core/module-kit';

/**
 * The core event bus (PRD G-17).
 *
 * Handlers run in registration order — which `modules:sync` fixes to module initialisation
 * order (dependencies first) — and sequentially, so a hook can rely on what earlier hooks
 * did. A throwing hook is recorded and logged; it never propagates to the emitter (G-7):
 * the core action already happened, and a module bug must not undo or hide that.
 */

export interface EmitResult {
  readonly event: CoreEventName;
  readonly delivered: number;
  readonly failed: readonly { module: string; error: string }[];
}

export interface Subscription {
  readonly module: string;
  readonly event: CoreEventName;
}

export interface EventBusOptions {
  /** Structured logger sink; defaults to console (JSON lines). */
  readonly log?: (entry: Record<string, unknown>) => void;
}

export interface EventBus {
  /** Subscribe one handler. Core code may subscribe too — use module `'core'`. */
  on<E extends CoreEventName>(event: E, handler: HookHandler<E>, module?: string): () => void;
  /** Subscribe everything a module declared in `hooks.ts`. */
  register(hooks: ModuleHooks): void;
  /** Emit after the core action succeeded. Resolves when every handler has run. Never throws. */
  emit<E extends CoreEventName>(
    event: E,
    payload: CoreEventPayloads[E],
    meta?: { requestId?: string | null },
  ): Promise<EmitResult>;
  subscriptions(): readonly Subscription[];
}

interface Entry {
  module: string;
  handler: (payload: unknown, ctx: HookContext) => void | Promise<void>;
}

export function createEventBus(opts: EventBusOptions = {}): EventBus {
  const log =
    opts.log ??
    ((entry: Record<string, unknown>) =>
      console.log(JSON.stringify({ t: new Date().toISOString(), ...entry })));
  const handlers = new Map<CoreEventName, Entry[]>();

  const on: EventBus['on'] = (event, handler, module = 'core') => {
    const list = handlers.get(event) ?? [];
    const entry: Entry = { module, handler: handler as Entry['handler'] };
    list.push(entry);
    handlers.set(event, list);
    return () => {
      const cur = handlers.get(event) ?? [];
      handlers.set(
        event,
        cur.filter((e) => e !== entry),
      );
    };
  };

  return {
    on,
    register(hooks) {
      for (const [event, handler] of Object.entries(hooks.handlers)) {
        if (handler)
          on(event as CoreEventName, handler as HookHandler<CoreEventName>, hooks.module);
      }
    },
    async emit(event, payload, meta = {}) {
      const list = handlers.get(event) ?? [];
      const ctx: HookContext = { event, requestId: meta.requestId ?? null, emittedAt: new Date() };
      const failed: { module: string; error: string }[] = [];
      let delivered = 0;
      for (const { module, handler } of list) {
        try {
          await handler(payload, ctx);
          delivered++;
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          failed.push({ module, error });
          log({
            level: 'error',
            msg: 'hook failed',
            event,
            module,
            error,
            requestId: ctx.requestId,
          });
        }
      }
      return { event, delivered, failed };
    },
    subscriptions() {
      const out: Subscription[] = [];
      for (const [event, list] of handlers)
        for (const e of list) out.push({ module: e.module, event });
      return out;
    },
  };
}
