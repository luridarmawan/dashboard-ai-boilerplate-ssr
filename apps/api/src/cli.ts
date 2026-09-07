/**
 * Command surface of the api process — the same for `bun apps/api/src/index.ts <cmd>` and the
 * compiled binary `api <cmd>` (Q-2). The production image carries the binary only: no `bun`, no
 * sources, no node_modules — so the operational one-offs live here as subcommands.
 *
 *   (none) | serve   HTTP server + scheduler (default)
 *   migrate          apply committed migrations — explicit, never on start (Q-4)
 *   seed             idempotent bootstrap seed (O-3)
 *   health           GET /v1/health on the local port; exit 0/1 — the image HEALTHCHECK
 *   version          print build identity (M-5) and exit
 *
 * Heavy branches are imported lazily so `health`/`version` never load the app or touch env().
 */
import rootPkg from '../../../package.json' with { type: 'json' };

export const COMMANDS = ['serve', 'migrate', 'seed', 'health', 'version', 'help'] as const;
export type Command = (typeof COMMANDS)[number];

export function parseCommand(argv: readonly string[]): Command {
  const [first] = argv;
  if (first === undefined) return 'serve';
  if (first === '-h' || first === '--help') return 'help';
  if (first === '-v' || first === '--version') return 'version';
  if ((COMMANDS as readonly string[]).includes(first)) return first as Command;
  throw new Error(`perintah tidak dikenal: ${first}\n${usage()}`);
}

export function usage(): string {
  return [
    'pemakaian: api [serve|migrate|seed|health|version|help]',
    '  serve    jalankan server HTTP + scheduler (baku)',
    '  migrate  terapkan migrasi skema yang tersemat — langkah eksplisit (Q-4)',
    '  seed     seed bootstrap idempoten: tenant baku, grup sistem, superadmin (O-3)',
    '  health   cek /v1/health di port lokal, keluar 0/1 — dipakai HEALTHCHECK image',
    '  version  cetak identitas build (nama, versi, commit, waktu build)',
  ].join('\n');
}

export function buildInfo(): {
  name: string;
  version: string;
  commit: string;
  builtAt: string | null;
} {
  return {
    name: rootPkg.name,
    version: rootPkg.version,
    commit: process.env.APP_COMMIT ?? 'dev',
    builtAt: process.env.APP_BUILT_AT ?? null,
  };
}

/** Liveness probe against this container's own port. Reads env directly: no validation, no DB. */
export async function probeHealth(
  opts: { port?: string | undefined; timeoutMs?: number } = {},
): Promise<boolean> {
  const port = opts.port ?? process.env.API_PORT ?? '3001';
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/health`, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? 3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  let cmd: Command;
  try {
    cmd = parseCommand(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
  switch (cmd) {
    case 'help':
      console.log(usage());
      return 0;
    case 'version': {
      const b = buildInfo();
      console.log(`${b.name} ${b.version} (${b.commit}${b.builtAt ? `, ${b.builtAt}` : ''})`);
      return 0;
    }
    case 'health':
      return (await probeHealth()) ? 0 : 1;
    case 'migrate': {
      const { describeMigrateResult, runMigrations } = await import('@core/db/migrate');
      console.log(describeMigrateResult(await runMigrations()));
      return 0;
    }
    case 'seed': {
      const { runSeedAll } = await import('@core/auth/seed-all');
      await runSeedAll();
      return 0;
    }
    case 'serve': {
      const { serve } = await import('./serve.ts');
      await serve();
      return -1; // keeps running; the signal handlers in serve() own the exit
    }
  }
}
