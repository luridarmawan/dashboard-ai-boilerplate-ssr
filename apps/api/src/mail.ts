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

export async function smtpFor(clientId: string | null): Promise<SmtpConfig | null> {
  const host = await settings.get<string | null>(clientId, 'mail.smtp_host');
  const fromAddress = await settings.get<string | null>(clientId, 'mail.from_address');
  if (!host || !fromAddress) return null;
  return {
    host,
    port: (await settings.get<number | null>(clientId, 'mail.smtp_port')) ?? 587,
    user: await settings.get<string | null>(clientId, 'mail.smtp_user'),
    password: await settings.get<string | null>(clientId, 'mail.smtp_password'),
    fromName: (await settings.get<string | null>(clientId, 'mail.from_name')) ?? 'Dashboard',
    fromAddress,
  };
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

/** Absolute link for an email, from the public origin. */
export function publicLink(path: string): string {
  return `${env().APP_ORIGIN_PRIMARY ?? 'http://127.0.0.1:5173'}${path}`;
}
