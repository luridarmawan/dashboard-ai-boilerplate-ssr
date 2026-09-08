import { env } from '@core/config';
import { fail } from '@core/contracts';
import { newId } from '@core/db';
import { Elysia } from 'elysia';

/**
 * Demo mode (PRD E-7): every write is refused with a clear message. Signing in and out stays
 * possible — a demo you cannot enter is not a demo. Runs before body parsing.
 */
const ALLOWED_WRITES = new Set([
  '/v1/auth/login',
  '/v1/auth/login/mfa',
  '/v1/auth/google-login',
  '/v1/auth/logout',
  '/v1/auth/switch-tenant',
]);

export const demoMode = new Elysia({ name: 'demo-mode' }).onRequest(({ request, set }) => {
  if (!env().DEMO_MODE) return;
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  const path = new URL(request.url).pathname;
  if (ALLOWED_WRITES.has(path)) return;
  set.status = 403;
  const rid = request.headers.get('x-request-id') ?? newId();
  set.headers['x-request-id'] = rid;
  return fail('demo_mode', 'Mode demo: perubahan tidak disimpan', rid);
});
