import { env } from '@core/config';
import { type Db, unsafeAcrossTenants } from '@core/db';
import {
  type Brand,
  deliverOutbox,
  type EnqueueInput,
  enqueueEmail,
  type SmtpConfig,
} from '@core/mail';
import { settings } from './services.ts';

/**
 * Email for the API (PRD J-1…J-3): requests enqueue; the scheduler job delivers. Brand and SMTP
 * come from runtime configuration (`app.*`, `mail.*`) at send time — change them in Settings,
 * the next delivery uses them.
 */
export async function sendTemplate(db: Db, input: EnqueueInput): Promise<string> {
  return enqueueEmail(db, input);
}

export async function brandFor(clientId: string | null): Promise<Brand> {
  const e = env();
  return {
    appName: (await settings.get<string | null>(clientId, 'app.name')) ?? 'Dashboard',
    logoUrl: (await settings.get<string | null>(clientId, 'app.logo_url')) ?? null,
    primary: (await settings.get<string | null>(clientId, 'app.brand_color')) ?? '#2563eb',
    origin: e.APP_ORIGIN_PRIMARY ?? 'http://127.0.0.1:5173',
  };
}

/** What the database holds for `mail.*` (null = empty) and what .env offers as bootstrap. */
export interface SmtpSources {
  readonly setting: {
    readonly host: string | null;
    readonly port: number | null;
    readonly user: string | null;
    readonly password: string | null;
    readonly fromName: string | null;
    readonly fromAddress: string | null;
  };
  readonly env: {
    readonly SMTP_HOST?: string | undefined;
    readonly SMTP_PORT?: number | undefined;
    readonly SMTP_USER?: string | undefined;
    readonly SMTP_PASSWORD?: string | undefined;
    readonly SMTP_SECURE?: boolean | undefined;
    readonly MAIL_FROM_ADDRESS?: string | undefined;
    readonly MAIL_FROM_NAME?: string | undefined;
  };
  readonly appName: string;
}

/**
 * Per field: database setting when filled, else .env (J-1, E-6). Host and from-address are the
 * minimum; without both there is no SMTP and the outbox keeps rows pending (or logs them outside
 * production). SMTP_SECURE only applies when the host itself comes from .env — a host configured
 * in Settings follows the port rule (465 = implicit TLS).
 */
export function resolveSmtp(src: SmtpSources): SmtpConfig | null {
  const { setting, env: e } = src;
  const host = setting.host ?? e.SMTP_HOST ?? null;
  const fromAddress = setting.fromAddress ?? e.MAIL_FROM_ADDRESS ?? null;
  if (!host || !fromAddress) return null;
  const hostFromEnv = setting.host === null;
  return {
    host,
    port: setting.port ?? e.SMTP_PORT ?? 587,
    user: setting.user ?? e.SMTP_USER ?? null,
    password: setting.password ?? e.SMTP_PASSWORD ?? null,
    fromName: setting.fromName ?? e.MAIL_FROM_NAME ?? src.appName,
    fromAddress,
    ...(hostFromEnv && e.SMTP_SECURE !== undefined ? { secure: e.SMTP_SECURE } : {}),
  };
}

export async function smtpFor(clientId: string | null): Promise<SmtpConfig | null> {
  const e = env();
  return resolveSmtp({
    setting: {
      host: await settings.get<string | null>(clientId, 'mail.smtp_host'),
      port: await settings.get<number | null>(clientId, 'mail.smtp_port'),
      user: await settings.get<string | null>(clientId, 'mail.smtp_user'),
      password: await settings.get<string | null>(clientId, 'mail.smtp_password'),
      fromName: await settings.get<string | null>(clientId, 'mail.from_name'),
      fromAddress: await settings.get<string | null>(clientId, 'mail.from_address'),
    },
    env: e,
    appName: (await settings.get<string | null>(clientId, 'app.name')) ?? 'Dashboard',
  });
}

/** One worker pass — called by the scheduler job `core.outbox.deliver`. */
export async function runOutboxOnce() {
  const db = unsafeAcrossTenants();
  const e = env();
  return deliverOutbox(db, {
    smtp: await smtpFor(null),
    brand: await brandFor(null),
    allowLogTransport: e.NODE_ENV !== 'production',
    limit: 25,
  });
}

/**
 * The browser-facing origin a link in an e-mail should use. The web app forwards the origin the
 * user is actually on (`x-forwarded-proto`/`x-forwarded-host`, else `origin`) with every API call;
 * when APP_ORIGIN lists the allowed origins, that forwarded origin is used only if it is one of
 * them (else the primary), and without APP_ORIGIN it is used as is — so a dev server on another
 * port, or a second domain of the same installation, gets links that point back to itself.
 */
export function publicOrigin(request?: Request | null): string {
  const e = env();
  let forwarded: string | null = null;
  if (request) {
    const proto = request.headers.get('x-forwarded-proto');
    const host = request.headers.get('x-forwarded-host');
    if (proto && host) forwarded = `${proto}://${host}`.toLowerCase();
    else {
      const origin = request.headers.get('origin');
      if (origin && /^https?:\/\//.test(origin)) forwarded = origin.toLowerCase();
    }
  }
  if (e.APP_ORIGINS.length) {
    if (forwarded && e.APP_ORIGINS.includes(forwarded)) return forwarded;
    return e.APP_ORIGIN_PRIMARY ?? forwarded ?? 'http://127.0.0.1:5173';
  }
  return forwarded ?? 'http://127.0.0.1:5173';
}

/** Absolute link for an e-mail, from the public origin of THIS request when one is given. */
export function publicLink(path: string, request?: Request | null): string {
  return `${publicOrigin(request)}${path}`;
}
