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
    /** Prometheus exposition at GET /metrics (M-6). Not proxied by Caddy: scrape inside the network. */
    METRICS_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    /** When set, /metrics requires `Authorization: Bearer <token>`. */
    METRICS_TOKEN: z.string().min(16).optional(),

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

    /** Upload storage root — a mapped volume in production (Q-9); used by STORAGE_DRIVER=local. */
    UPLOADS_DIR: z.string().min(1).default('./data/uploads'),
    /** Where uploaded bytes live (Q-16): the local volume, or any S3-compatible bucket (S3_*). */
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    S3_ENDPOINT: z.url().optional(),
    S3_BUCKET: z.string().min(1).optional(),
    S3_REGION: z.string().min(1).default('auto'),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    /** Public base URL of the bucket/CDN; when set, public files are linked directly instead of through the API. */
    S3_PUBLIC_URL: z.url().optional(),
    S3_VIRTUAL_HOSTED_STYLE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

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
    /**
     * Public origin(s), comma-separated: `https://app.example.com,https://apps.other.id,localhost`.
     * Every entry is accepted by the CSRF Origin check (Decision E); an entry without a scheme
     * (`localhost`, `localhost:8080`) means both http and https. The first https entry (else the
     * first entry) is the primary origin used for absolute links in emails.
     */
    APP_ORIGIN: z
      .string()
      .optional()
      .refine((raw) => raw === undefined || parseOrigins(raw).length > 0, {
        message:
          'daftar origin dipisah koma, mis. https://app.example.com,localhost — setiap entri harus host atau URL yang valid',
      }),
    /**
     * SMTP bootstrap (J-1). Used when the matching `mail.*` setting is EMPTY in the database, so an
     * operator can wire email from .env at deploy time and an admin can still override it from
     * Settings later (E-6). SMTP_SECURE defaults to "port 465 = implicit TLS, otherwise STARTTLS".
     */
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    SMTP_SECURE: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),
    MAIL_FROM_ADDRESS: z.email().optional(),
    MAIL_FROM_NAME: z.string().min(1).max(120).optional(),
    /**
     * Google sign-in bootstrap (A-8): used when `security.google_client_id` / `_secret` are EMPTY
     * in the database, same rule as SMTP_*. The feature itself is switched on in Settings.
     */
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    /** Test seams only: point the code exchange and identity lookup at a local stand-in for Google. */
    GOOGLE_OAUTH_TOKEN_URL: z.url().optional(),
    GOOGLE_OAUTH_USERINFO_URL: z.url().optional(),
    /**
     * Dev web server address (also read by apps/web/vite.config.ts). The api uses it only as the
     * LAST fallback for links in e-mails when neither APP_ORIGIN nor a forwarding request is there.
     */
    WEB_HOST: z.string().min(1).optional(),
    WEB_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    /** Login attempts per window, per IP and per email (A-2): `<limit>/<seconds>`. */
    LOGIN_RATE_LIMIT: z
      .string()
      .regex(/^\d+\s*\/\s*\d+$/)
      .default('10/900'),
    /** Bootstrap the first superadmin on seed (C-5). Only read by `bun db:seed`. */
    BOOTSTRAP_ADMIN_EMAIL: z.email().optional(),
    BOOTSTRAP_ADMIN_PASSWORD: z.string().min(10).optional(),

    /** Bootstrap fallback only — the real value lives in database configuration (§4.7). */
    LANDING_ROUTE: z.string().startsWith('/').default('/example'),

    /**
     * Fixed copy of a self-hosted deployment: the headline and lead of the built-in landing page
     * and the line in every footer. These are BRANDING, not runtime settings — they must be right
     * in the very first HTML a visitor sees, before any database exists, so they live here and not
     * in `configurations`. Unset = the translated defaults (`landing.title`, `landing.lead`,
     * `shell.footer`). `APP_LANDING_TITLE` also titles the OpenAPI document (N-2).
     */
    APP_LANDING_TITLE: z.string().max(200).optional(),
    APP_LANDING_LEAD: z.string().max(500).optional(),
    APP_FOOTER_TITLE: z.string().max(200).optional(),
  })
  .transform((env) => ({
    ...env,
    SIGNUP_ENABLED: env.SIGNUP_ENABLED ?? env.NODE_ENV !== 'production',
  }))
  .superRefine((env, ctx) => {
    const drivers = ['SESSION_DRIVER', 'CACHE_DRIVER', 'RATELIMIT_DRIVER'] as const;

    if (env.STORAGE_DRIVER === 's3') {
      for (const key of [
        'S3_ENDPOINT',
        'S3_BUCKET',
        'S3_ACCESS_KEY_ID',
        'S3_SECRET_ACCESS_KEY',
      ] as const) {
        if (!env[key])
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'wajib diisi bila STORAGE_DRIVER=s3',
          });
      }
    }
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
  })
  .transform((env) => {
    const APP_ORIGINS = parseOrigins(env.APP_ORIGIN);
    return {
      ...env,
      /** Normalised allow-list derived from APP_ORIGIN (lowercase origins, no paths). */
      APP_ORIGINS,
      /** Origin for absolute links (emails, sitemap fallbacks): first https entry, else the first. */
      APP_ORIGIN_PRIMARY: APP_ORIGINS.find((o) => o.startsWith('https://')) ?? APP_ORIGINS[0],
    };
  });

/**
 * `APP_ORIGIN` → normalised origin list. Entries with a scheme keep it; bare hosts expand to
 * http:// and https://. Invalid entries are dropped (the schema refine rejects an all-invalid value).
 */
export function parseOrigins(raw: string | undefined): string[] {
  const out = new Set<string>();
  for (const entry of (raw ?? '').split(',')) {
    const e = entry.trim();
    if (!e) continue;
    const candidates = /^[a-z][a-z0-9+.-]*:\/\//i.test(e) ? [e] : [`http://${e}`, `https://${e}`];
    for (const c of candidates) {
      try {
        const u = new URL(c);
        if (u.origin !== 'null' && (u.protocol === 'http:' || u.protocol === 'https:'))
          out.add(u.origin.toLowerCase());
      } catch {
        /* skip invalid entry */
      }
    }
  }
  return [...out];
}

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

/**
 * One env value, read WITHOUT validating the whole environment. Both the OpenAPI document and
 * the `app.landing_route` default are built while modules are still being imported, and importing
 * must never require a complete environment (see apps/api/src/services.ts) — while `env()` would
 * throw on the first missing variable. The keys are still declared in the schema above, so
 * `preflight` validates them like every other one. Empty or blank = "not set".
 */
export function rawEnv(
  key: keyof Env,
  source: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const v = source[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
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
