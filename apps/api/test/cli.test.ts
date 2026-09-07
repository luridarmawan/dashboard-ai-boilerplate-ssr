import { describe, expect, test } from 'bun:test';
import rootPkg from '../../../package.json' with { type: 'json' };
import { buildInfo, COMMANDS, parseCommand, probeHealth, usage } from '../src/cli.ts';

// The compiled binary (Q-2) exposes the ops one-offs as subcommands; the image HEALTHCHECK
// runs `api health`, so its exit semantics are contract, not convenience.
describe('api cli (Q-2)', () => {
  test('no argument = serve; every command parses to itself', () => {
    expect(parseCommand([])).toBe('serve');
    for (const c of COMMANDS) expect(parseCommand([c])).toBe(c);
    expect(parseCommand(['--help'])).toBe('help');
    expect(parseCommand(['-h'])).toBe('help');
    expect(parseCommand(['--version'])).toBe('version');
  });

  test('unknown command fails loudly with usage', () => {
    expect(() => parseCommand(['migrat'])).toThrow(/tidak dikenal: migrat/);
    expect(() => parseCommand(['migrat'])).toThrow(/pemakaian: api/);
  });

  test('usage names every user-facing command', () => {
    const u = usage();
    for (const c of COMMANDS.filter((c) => c !== 'help')) expect(u).toContain(c);
  });

  test('build identity comes from the bundled package.json, not a runtime file read', () => {
    const b = buildInfo();
    expect(b.name).toBe(rootPkg.name);
    expect(b.version).toBe(rootPkg.version);
    expect(typeof b.commit).toBe('string');
  });

  test('health probe: ok → true, non-2xx → false, closed port → false', async () => {
    let status = 200;
    const srv = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: (req) =>
        new URL(req.url).pathname === '/v1/health'
          ? new Response('{"success":true}', { status })
          : new Response('nope', { status: 404 }),
    });
    try {
      expect(await probeHealth({ port: String(srv.port) })).toBe(true);
      status = 503;
      expect(await probeHealth({ port: String(srv.port) })).toBe(false);
    } finally {
      srv.stop(true);
    }
    expect(await probeHealth({ port: String(srv.port), timeoutMs: 500 })).toBe(false);
  });
});
