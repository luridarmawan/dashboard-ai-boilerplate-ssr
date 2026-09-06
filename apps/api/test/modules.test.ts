import { describe, expect, test } from 'bun:test';
import { app } from '../src/app.ts';

const call = (path: string) => app.handle(new Request(`http://api.test${path}`));

/** M0 gate 4, API half: the Dummy module's routes exist under /v1/m/dummy without any core edit. */
describe('module API mounting (G-2, G-9, N-2)', () => {
  test('/v1/m/dummy/ping answers through the module plugin', async () => {
    const res = await call('/v1/m/dummy/ping');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { module: string } };
    expect(body.success).toBe(true);
    expect(body.data.module).toBe('dummy');
  });

  test('module routes appear in the runtime OpenAPI document with the module tag', async () => {
    const spec = (await (await call('/openapi.json')).json()) as {
      paths: Record<string, { get?: { tags?: string[] } }>;
    };
    expect(spec.paths['/v1/m/dummy/ping']).toBeDefined();
    expect(spec.paths['/v1/m/dummy/notes/count']).toBeDefined();
    expect(spec.paths['/v1/m/dummy/ping']?.get?.tags).toContain('module:dummy');
  });

  test('a module cannot be reached outside its namespace', async () => {
    expect((await call('/v1/ping')).status).toBe(404);
    expect((await call('/v1/m/ping')).status).toBe(404);
  });
});
