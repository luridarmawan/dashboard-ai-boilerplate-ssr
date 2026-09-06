import { describe, expect, test } from 'bun:test';
import { app } from '../src/app.ts';

/**
 * M3 gate #2: /openapi.json is generated from the same route schemas that validate requests
 * (N-1, N-2), so what it documents IS the behaviour. The typed Eden client compiles against
 * `App` in `bun check`; here we assert the document itself covers the surface and the envelope.
 */
describe('OpenAPI document (N-1, N-2, gate M3 #2)', () => {
  test('every domain from Appendix A is present, with the envelope and stable error codes', async () => {
    const res = await app.handle(new Request('http://api.test/openapi.json'));
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      openapi: string;
      paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
    };
    expect(doc.openapi.startsWith('3.1')).toBe(true);
    const paths = Object.keys(doc.paths);
    for (const p of [
      '/v1/health',
      '/v1/ready',
      '/v1/version',
      '/v1/auth/login',
      '/v1/auth/register',
      '/v1/auth/logout',
      '/v1/auth/csrf-token',
      '/v1/auth/permissions',
      '/v1/auth/switch-tenant',
      '/v1/users/',
      '/v1/users/{id}',
      '/v1/users/profile/me',
      '/v1/groups/',
      '/v1/group-permissions/{id}',
      '/v1/group-members/{id}',
      '/v1/clients/',
      '/v1/clients/scope',
      '/v1/configuration/',
      '/v1/configuration/public',
      '/v1/themes/',
      '/v1/module/',
      '/v1/module/{id}/enabled',
      '/v1/menu/',
      '/v1/m/dummy/ping',
    ]) {
      expect(paths, `missing ${p}`).toContain(p);
    }
    // Every operation documents its responses (schemas attached at the route → nothing undocumented).
    for (const [p, ops] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) continue;
        expect(op.responses, `${method.toUpperCase()} ${p} has no responses`).toBeDefined();
      }
    }
    const text = JSON.stringify(doc);
    expect(text).toContain('"requestId"');
    expect(text).toContain('module_disabled');
    expect(text).toContain('demo_mode');
    expect(paths.length).toBeGreaterThanOrEqual(40);
  });
});
