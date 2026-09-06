import { fail } from '@core/contracts';
import { newId } from '@core/db';
import { logger } from '@core/logger';
import { Elysia } from 'elysia';

/**
 * Cross-cutting request plumbing (PRD M-1, N-4):
 *
 *   - a request id on every request — taken from `x-request-id` when the caller (SvelteKit)
 *     already minted one, so one id follows a page load web → API → log; minted otherwise
 *   - one structured JSON log line per response, with that id
 *   - every error mapped to the failure envelope, with that id, and no stack in production
 *
 * Marked `as: 'global'` so it applies to routes registered by modules too.
 */

const isProd = process.env.NODE_ENV === 'production';

export const requestContext = new Elysia({ name: 'request-context' })
  .derive({ as: 'global' }, ({ request, set }) => {
    const requestId = request.headers.get('x-request-id') ?? newId();
    set.headers['x-request-id'] = requestId;
    return { requestId, startedAt: performance.now() };
  })
  .onAfterResponse({ as: 'global' }, (ctx) => {
    // Structured log (M-1). Nothing sensitive is logged — no headers, no body (M-7).
    // `path` comes from Elysia's context; logging must never throw, whatever the fast path did.
    try {
      const { path, request, set, requestId, startedAt } = ctx;
      logger.info('request', {
        method: request?.method ?? '?',
        path,
        status: set.status ?? 200,
        ms: Math.round((performance.now() - startedAt) * 10) / 10,
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

/** Elysia's validation error carries the offending path/message; expose only that. */
function safeValidation(error: unknown): unknown {
  const e = error as { all?: unknown; message?: string };
  return e.all ?? e.message;
}
