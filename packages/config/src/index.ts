import { z } from 'zod';

/**
 * Validated env loader (PRD P-4, E-6).
 *
 * The boundary is strict: `.env` holds only what is needed BEFORE the database can be
 * read. If a value may reasonably be changed by an admin without a restart, it belongs
 * in the `configurations` table, not here — do not add it to this schema.
 */

export const DIALECTS = ['mysql', 'mariadb', 'postgres'] as const;
export type Dialect = (typeof DIALECTS)[number];

export const STATE_DRIVERS = ['database', 'redis', 'memory'] as const;
export type StateDriver = (typeof STATE_DRIVERS)[number];

const URL_SCHEME_BY_DIALECT: Record<Dialect, readonly string[]> = {
  mysql: ['mysql:'],
  mariadb: ['mysql:', 'mariadb:'],
  postgres: ['postgres:', 'postgresql:'],
};

const driver = z.enum(STATE_DRIVERS).default('database');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    DB_DIALECT: z.enum(DIALECTS).default('mysql'),
    DATABASE_URL: z.url({ error: 'wajib diisi, mis. mysql://user:pass@host:3306/db' }),
    TABLE_PREFIX: z
      .string()
      .regex(/^[a-z0-9_]*$/, 'hanya huruf kecil, angka, dan underscore')
      .default(''),

    SESSION_DRIVER: driver,
    CACHE_DRIVER: driver,
    RATELIMIT_DRIVER: driver,
    REDIS_URL: z.url().optional(),

    /** Port the Elysia process listens on; the reverse proxy fronts it in production (§4.4). */
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    /** Where SvelteKit's server-side code reaches the API — internal hop, same host by default. */
    API_URL: z.url().default('http://127.0.0.1:3001'),

    /** Bootstrap fallback only — the real value lives in database configuration (§4.7). */
    LANDING_ROUTE: z.string().startsWith('/').default('/m/example'),
  })
  .superRefine((env, ctx) => {
    const drivers = ['SESSION_DRIVER', 'CACHE_DRIVER', 'RATELIMIT_DRIVER'] as const;

    for (const key of drivers) {
      // Anti-pattern D1 must not be bypassed through configuration (Decision M, rule 2).
      if (env.NODE_ENV === 'production' && env[key] === 'memory') {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'adapter `memory` dilarang di production — pakai `database` (baku) atau `redis`',
        });
      }
      if (env[key] === 'redis' && !env.REDIS_URL) {
        ctx.addIssue({
          code: 'custom',
          path: ['REDIS_URL'],
          message: `wajib diisi karena ${key}=redis`,
        });
      }
    }

    const scheme = safeScheme(env.DATABASE_URL);
    const allowed = URL_SCHEME_BY_DIALECT[env.DB_DIALECT];
    if (scheme && !allowed.includes(scheme)) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: `skema URL "${scheme}" tidak cocok dengan DB_DIALECT=${env.DB_DIALECT} (diharapkan ${allowed.join(' atau ')})`,
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Konfigurasi env tidak valid:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'EnvError';
  }
}

/** Parse & validate. Throws `EnvError` carrying ALL problems at once, not one at a time. */
export function loadEnv(source: Readonly<Record<string, string | undefined>> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;
  const problems = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  throw new EnvError(problems);
}

let cached: Env | undefined;

/** Lazy singleton. The process fails fast on first call if the env is invalid. */
export function env(): Env {
  cached ??= loadEnv();
  return cached;
}

/** For tests: drop the cache so `env()` re-reads. */
export function resetEnvCache(): void {
  cached = undefined;
}

function safeScheme(url: string): string | null {
  try {
    return new URL(url).protocol;
  } catch {
    return null;
  }
}
