import type { App } from '@app/api/app';
import { treaty } from '@elysiajs/eden';
import { env } from '$env/dynamic/private';

/**
 * The typed API client (N-3). Server-side only: `load` functions call the API with the
 * request's id so one id follows the page web → API → log (M-1). A breaking API change
 * fails `bun run typecheck` here, not at runtime.
 */
export function api(requestId: string) {
  return treaty<App>(env.API_URL ?? 'http://127.0.0.1:3001', {
    headers: { 'x-request-id': requestId },
  });
}
