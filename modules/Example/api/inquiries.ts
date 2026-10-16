import { publish } from '@app/api/mqtt';
import { notify } from '@app/api/notifications';
import { writeAudit } from '@core/auth';
import { forTenant, newId, schema, unsafeAcrossTenants } from '@core/db';

/**
 * One inquiry, however it arrived — the contact form, the signed inbound route (extension point
 * 17) or the MQTT subscription (extension point 18) — is stored, announced and audited the same
 * way. The transport only decides how the caller proved itself; everything after that is here.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface InboundInquiry {
  readonly name: string;
  readonly email: string;
  readonly message: string;
  readonly source: string | null;
}

/** A JSON body from outside, checked by hand: it arrives as raw text (HTTP) or bytes (MQTT). */
export function inboundInquiry(v: unknown): InboundInquiry | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const str = (x: unknown, min: number, max: number) =>
    typeof x === 'string' && x.trim().length >= min && x.trim().length <= max ? x.trim() : null;
  const name = str(o.name, 2, 191);
  const email = str(o.email, 3, 191)?.toLowerCase() ?? null;
  const message = str(o.message, 10, 5000);
  if (!name || !email || !EMAIL_RE.test(email) || !message) return null;
  return { name, email, message, source: str(o.source, 1, 191) };
}

export interface RecordInquiryOptions {
  /** Where it came from when the body does not say (`inbound`, `mqtt`, the form's own `source`). */
  readonly fallbackSource: string | null;
  readonly ip: string | null;
  readonly requestId: string | null;
}

/**
 * Store the inquiry for this tenant, ring the bell of everyone who may read inquiries (J-4),
 * write the audit row, and — when the MQTT client is on — announce it on
 * `example/<tenant>/inquiry.created` so an external system can react without polling. The
 * publish outcome is deliberately ignored: MQTT is optional to this module, the row is not.
 */
export async function recordInquiry(
  clientId: string,
  body: InboundInquiry,
  opts: RecordInquiryOptions,
): Promise<string> {
  const id = newId();
  const source = body.source ?? opts.fallbackSource;
  await forTenant(clientId).insert(schema.exampleInquiries, {
    id,
    name: body.name,
    email: body.email,
    message: body.message,
    source,
    ip: opts.ip,
  });
  await notify({
    clientId,
    permission: 'example.inquiry.read',
    type: 'example.inquiry',
    title: `Pesan baru dari ${body.name}`,
    body: body.message.slice(0, 200),
    link: '/m/example/inquiries',
    data: { inquiryId: id },
  });
  await writeAudit(unsafeAcrossTenants(), {
    clientId,
    actorId: null,
    action: 'example.inquiry.create',
    resource: 'example.inquiry',
    resourceId: id,
    ip: opts.ip,
    requestId: opts.requestId,
    after: { email: body.email, source },
  });
  await publish(
    `example/${clientId}/inquiry.created`,
    JSON.stringify({ id, name: body.name, source, at: new Date().toISOString() }),
  );
  return id;
}
