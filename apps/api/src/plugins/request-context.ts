import { fail } from '@core/contracts';
import { newId } from '@core/db';
import { logger } from '@core/logger';
import { Elysia } from 'elysia';
import { observeRequest } from '../metrics.ts';

/**
 * Cross-cutting request plumbing (PRD M-1, N-4):
 *
 *   - a request id on every request — taken from `x-request-id` when the caller (SvelteKit)
 *     already minted one, so one id follows a page load web → API → log; minted otherwise
 *   - one structured JSON log line per response, with that id
 *   - every error mapped to the failure envelope, with that id, and no stack in production
 *   - request count, latency and error class recorded for /metrics (M-6)
 *
 * Marked `as: 'global'` so it applies to routes registered by modules too.
 */

const isProd = process.env.NODE_ENV === 'production';

/** Start times keyed by request: `onRequest` sees every request, matched or not (404s too). */
const started = new WeakMap<Request, number>();

export const requestContext = new Elysia({ name: 'request-context' })
  // onRequest runs before routing for every request; it takes no scope option (always process-wide).
  .onRequest(({ request }) => {
    started.set(request, performance.now());
  })
  .derive({ as: 'global' }, ({ request, set }) => {
    const requestId = request.headers.get('x-request-id') ?? newId();
    set.headers['x-request-id'] = requestId;
    return { requestId, startedAt: started.get(request) ?? performance.now() };
  })
  .onAfterResponse({ as: 'global' }, (ctx) => {
    // Structured log (M-1). Nothing sensitive is logged — no headers, no body (M-7).
    // `path` comes from Elysia's context; logging must never throw, whatever the fast path did.
    try {
      const { path, request, set, requestId } = ctx;
      const status = Number(set.status ?? 200) || 200;
      const t0 = started.get(request) ?? ctx.startedAt ?? performance.now();
      const ms = Math.round((performance.now() - t0) * 10) / 10;
      // An unmatched path is not a route: label it as such so scans cannot inflate cardinality.
      const route = status === 404 ? '(unmatched)' : (ctx as { route?: string }).route;
      observeRequest(request?.method ?? '?', route, path, status, ms);
      logger.info('request', {
        method: request?.method ?? '?',
        path,
        status,
        ms,
        requestId,
      });
    } catch {
      /* a broken log line must not break a response */
    }
  })
  .onError({ as: 'global' }, ({ code, error, set, request }) => {
    const requestId = request.headers.get('x-request-id') ?? set.headers['x-request-id'] ?? newId();
    if (typeof requestId === 'string') set.headers['x-request-id'] = requestId;
    const rid = String(requestId);

    switch (code) {
      case 'NOT_FOUND':
        set.status = 404;
        return fail('not_found', 'Route tidak ditemukan', rid);
      case 'VALIDATION':
        set.status = 422;
        return fail('validation_failed', 'Permintaan tidak valid', rid, safeValidation(error));
      case 'PARSE':
        set.status = 422;
        return fail('validation_failed', 'Body tidak bisa dibaca', rid);
      default: {
        set.status = 500;
        logger.error('unhandled', {
          requestId: rid,
          error: error instanceof Error ? error.message : String(error),
          // Drizzle wraps driver errors as "Failed query: …"; the actionable part (ER_NO_DB_ERROR,
          // "Table … doesn't exist", ECONNREFUSED, "Access denied") lives in the cause chain.
          cause: describeCause(error),
          stack: !isProd && error instanceof Error ? error.stack : undefined,
        });
        return fail(
          'internal_error',
          isProd
            ? 'Terjadi kesalahan internal'
            : error instanceof Error
              ? error.message
              : String(error),
          rid,
        );
      }
    }
  });

/** `code`/`errno` + message of every nested `cause`, joined — null when there is none. */
export function describeCause(error: unknown): string | null {
  const parts: string[] = [];
  let cur = error instanceof Error ? error.cause : undefined;
  for (let depth = 0; cur && depth < 5; depth++) {
    const e = cur as { code?: unknown; errno?: unknown; message?: unknown; cause?: unknown };
    const tag = [e.code, e.errno].filter((x) => x !== undefined && x !== null).join('/');
    const msg = typeof e.message === 'string' ? e.message : String(cur);
    parts.push(tag ? `${tag}: ${msg}` : msg);
    cur = e.cause;
  }
  return parts.length ? parts.join(' ← ') : null;
}

/** Elysia's validation error carries the offending path/message; expose only that. */
function safeValidation(error: unknown): unknown {
  const e = error as { all?: unknown; message?: string };
  return e.all ?? e.message;
}
