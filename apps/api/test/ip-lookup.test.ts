import { afterEach, describe, expect, test } from 'bun:test';
import { resetEnvCache } from '@core/config';
import { clearIpLookupCache, isIpLiteral, lookupIp, parseIpInfo } from '../src/lib/ip-lookup.ts';

describe('IP lookup', () => {
  afterEach(() => {
    clearIpLookupCache();
    delete process.env.IP_LOOKUP_URL;
    resetEnvCache();
  });
  const useService = (url: string) => {
    process.env.IP_LOOKUP_URL = url;
    resetEnvCache();
  };

  test('only IP literals are accepted', () => {
    expect(isIpLiteral('8.8.8.8')).toBe(true);
    expect(isIpLiteral('2001:db8::1')).toBe(true);
    expect(isIpLiteral('256.1.1.1')).toBe(false);
    expect(isIpLiteral('example.com')).toBe(false);
    expect(isIpLiteral('1.1.1.1/../x')).toBe(false);
  });

  test('reads the ipwho.is shape', () => {
    const info = parseIpInfo('8.8.8.8', {
      success: true,
      city: 'Mountain View',
      region: 'California',
      country: 'United States',
      country_code: 'US',
      connection: { asn: 15169, org: 'Google LLC', isp: 'Google LLC' },
    });
    expect(info).toMatchObject({
      city: 'Mountain View',
      region: 'California',
      country: 'United States',
      countryCode: 'US',
      isp: 'Google LLC',
      asn: 'AS15169',
    });
  });

  test('reads the ip-api.com shape and its refusals', () => {
    expect(
      parseIpInfo('1.1.1.1', {
        status: 'success',
        city: 'Sydney',
        regionName: 'New South Wales',
        country: 'Australia',
        countryCode: 'AU',
        isp: 'Cloudflare',
        as: 'AS13335 Cloudflare, Inc.',
      }),
    ).toMatchObject({ region: 'New South Wales', countryCode: 'AU', isp: 'Cloudflare' });
    expect(parseIpInfo('1.1.1.1', { status: 'fail' })).toBeNull();
    expect(parseIpInfo('1.1.1.1', { success: false })).toBeNull();
  });

  test('private addresses never leave the server', async () => {
    useService('http://127.0.0.1:1/{ip}');
    const r = await lookupIp('192.168.1.10');
    expect(r).toMatchObject({ ok: true, info: { private: true, country: null } });
  });

  test('asks the configured service once, then answers from the cache', async () => {
    let calls = 0;
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        calls++;
        const ip = new URL(req.url).pathname.slice(1);
        return Response.json({ success: true, ip, city: 'Jakarta', country: 'Indonesia' });
      },
    });
    try {
      useService(`http://127.0.0.1:${server.port}/{ip}`);
      const a = await lookupIp('36.66.1.2');
      const b = await lookupIp('36.66.1.2');
      expect(a).toMatchObject({ ok: true, info: { city: 'Jakarta', country: 'Indonesia' } });
      expect(b).toEqual(a);
      expect(calls).toBe(1);
    } finally {
      server.stop(true);
    }
  });

  test('`off` asks nobody', async () => {
    useService('off');
    expect(await lookupIp('36.66.1.4')).toEqual({ ok: false, reason: 'disabled' });
  });

  test('a dead service is reported, not thrown', async () => {
    useService('http://127.0.0.1:1/{ip}');
    expect(await lookupIp('36.66.1.3')).toEqual({ ok: false, reason: 'failed' });
  });
});
