import { env } from '@core/config';
import { isPrivateAddress } from '@core/contracts';

/**
 * Where an IP address is, roughly (city, region, country, network) — the "?" next to the IP
 * columns of the user list. The answer comes from an outside service (`IP_LOOKUP_URL`); a
 * private address never leaves the server, it is answered here as "local network".
 */
export interface IpInfo {
  readonly ip: string;
  /** Private, loopback or link-local: there is nothing to look up. */
  readonly private: boolean;
  readonly city: string | null;
  readonly region: string | null;
  readonly country: string | null;
  readonly countryCode: string | null;
  /** Provider / organisation owning the address block. */
  readonly isp: string | null;
  readonly asn: string | null;
}

export type IpLookup =
  | { readonly ok: true; readonly info: IpInfo }
  | { readonly ok: false; readonly reason: 'disabled' | 'failed' };

/** An address's location barely moves; a day spares the service and the admin's wait. */
const TTL_MS = 24 * 3600_000;
const MAX_ENTRIES = 1000;
const TIMEOUT_MS = 5000;
const cache = new Map<string, { at: number; info: IpInfo }>();

const IPV4 = /^(\d{1,3})(\.\d{1,3}){3}$/;
const IPV6 = /^[0-9a-f:.]+$/i;

/** Only IP literals are looked up: the value ends up in the provider's URL path. */
export function isIpLiteral(v: string): boolean {
  if (IPV4.test(v)) return v.split('.').every((p) => Number(p) <= 255);
  return v.includes(':') && v.length <= 45 && IPV6.test(v);
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Reads both the ipwho.is shape and the ip-api.com shape; null when the service said no. */
export function parseIpInfo(ip: string, body: unknown): IpInfo | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.success === false || b.status === 'fail') return null;
  const conn = (b.connection && typeof b.connection === 'object' ? b.connection : {}) as Record<
    string,
    unknown
  >;
  const asn = conn.asn ?? b.as ?? null;
  return {
    ip,
    private: false,
    city: str(b.city),
    region: str(b.region) ?? str(b.regionName),
    country: str(b.country),
    countryCode: str(b.country_code) ?? str(b.countryCode),
    isp: str(conn.isp) ?? str(conn.org) ?? str(b.isp) ?? str(b.org),
    asn: typeof asn === 'number' ? `AS${asn}` : str(asn),
  };
}

export async function lookupIp(ip: string): Promise<IpLookup> {
  if (isPrivateAddress(ip)) {
    return {
      ok: true,
      info: {
        ip,
        private: true,
        city: null,
        region: null,
        country: null,
        countryCode: null,
        isp: null,
        asn: null,
      },
    };
  }
  const template = env().IP_LOOKUP_URL;
  if (template === 'off') return { ok: false, reason: 'disabled' };
  const hit = cache.get(ip);
  if (hit && Date.now() - hit.at < TTL_MS) return { ok: true, info: hit.info };
  try {
    const res = await fetch(template.replace('{ip}', encodeURIComponent(ip)), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, reason: 'failed' };
    const info = parseIpInfo(ip, await res.json());
    if (!info) return { ok: false, reason: 'failed' };
    // Oldest first out: Map keeps insertion order.
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
    cache.set(ip, { at: Date.now(), info });
    return { ok: true, info };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** Tests only: forget cached answers. */
export function clearIpLookupCache(): void {
  cache.clear();
}
