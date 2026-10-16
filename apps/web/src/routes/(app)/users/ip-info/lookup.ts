import type { RequestEvent } from '@sveltejs/kit';
import { apiFor, unwrap } from '$lib/server/session';

export interface IpInfo {
  ip: string;
  private: boolean;
  city: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  isp: string | null;
  asn: string | null;
}

/** Why there is no answer, as an i18n key suffix: the API's message is never rendered. */
export type IpInfoError = 'not_found' | 'disabled' | 'failed';

/** Shared by the JSON endpoint (the "?" popover) and the page it falls back to without JS. */
export async function lookupIp(
  event: RequestEvent,
  ip: string,
): Promise<{ ok: true; info: IpInfo } | { ok: false; status: number; error: IpInfoError }> {
  if (!ip) return { ok: false, status: 404, error: 'not_found' };
  const r = unwrap<{ success: true; data: IpInfo }>(
    await apiFor(event).v1.users['ip-info'].get({ query: { ip } }),
  );
  if (r.ok) return { ok: true, info: r.data.data };
  const reason = (r.failure.details as { reason?: string } | undefined)?.reason;
  const error: IpInfoError =
    r.failure.status === 404 ? 'not_found' : reason === 'disabled' ? 'disabled' : 'failed';
  if (r.failure.status === 401 || r.failure.status === 403) {
    return { ok: false, status: r.failure.status, error: 'not_found' };
  }
  return { ok: false, status: r.failure.status, error };
}
