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

    /** Bind address. 127.0.0.1 on a developer machine; 0.0.0.0 inside a container. */
    API_HOST: z.string().min(1).default('127.0.0.1'),
    /** Port the Elysia process listens on; the reverse proxy fronts it in production (§4.4). */
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    /** Where SvelteKit's server-side code reaches the API — internal hop, same host by default. */
    API_URL: z.url().default('http://127.0.0.1:3001'),

    /** Run the scheduler in this process (G-18). Off for one-off scripts or a dedicated worker split. */
    SCHEDULER_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    /** Stable identity of this process in lease rows and logs; defaults to hostname:pid. */
    INSTANCE_ID: z.string().min(1).optional(),

    /** Upload storage root — a mapped volume in production (Q-9). Local adapter; S3 is optional later (Q-16). */
    UPLOADS_DIR: z.string().min(1).default('./data/uploads'),

    /** E-7: every write is refused with a clear message. Lives in .env because it must hold even when the database is read-only. */
    DEMO_MODE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    /** Self-service registration (A-1). Off by default in production; on for development. */
    SIGNUP_ENABLED: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),
    /** Session lifetime; the cookie and the row expire together (A-3). */
    SESSION_TTL_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 365)
      .default(720),
    /** Public origin, e.g. https://app.example.com — used for the CSRF Origin check and absolute links. */
    APP_ORIGIN: z.url().optional(),
    /** Login attempts per window, per IP and per email (A-2): `<limit>/<seconds>`. */
    LOGIN_RATE_LIMIT: z
      .string()
      .regex(/^\d+\s*\/\s*\d+$/)
      .default('10/900'),
    /** Bootstrap the first superadmin on seed (C-5). Only read by `bun db:seed`. */
    BOOTSTRAP_ADMIN_EMAIL: z.email().optional(),
    BOOTSTRAP_ADMIN_PASSWORD: z.string().min(10).optional(),

    /** Bootstrap fallback only — the real value lives in database configuration (§4.7). */
    LANDING_ROUTE: z.string().startsWith('/').default('/m/example'),
  })
  .transform((env) => ({
    ...env,
    SIGNUP_ENABLED: env.SIGNUP_ENABLED ?? env.NODE_ENV !== 'production',
  }))
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
  // An empty value means "not set": compose files and CI commonly pass `VAR=` for optional
  // settings, and `REDIS_URL=` must not be rejected as an invalid URL.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const result = envSchema.safeParse(cleaned);
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
