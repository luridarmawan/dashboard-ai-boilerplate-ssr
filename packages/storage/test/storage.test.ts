import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertKey,
  extensionFor,
  isAllowedType,
  LocalStorage,
  S3Storage,
  sniffMime,
} from '../src/index.ts';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe('@core/storage (Q-9, Q-16)', () => {
  test('local adapter: put/get/exists/delete under the root; content type travels with the object', async () => {
    const root = mkdtempSync(join(tmpdir(), 'crk-storage-'));
    const s = new LocalStorage(root);
    await s.put('t1/2026/09/a.png', PNG, 'image/png');
    expect(await s.exists('t1/2026/09/a.png')).toBe(true);
    const got = await s.get('t1/2026/09/a.png');
    expect(got?.contentType).toBe('image/png');
    expect(Array.from(got?.bytes ?? [])).toEqual(Array.from(PNG));
    await s.delete('t1/2026/09/a.png');
    expect(await s.exists('t1/2026/09/a.png')).toBe(false);
    expect(await s.get('t1/2026/09/a.png')).toBeNull();
    expect(s.publicUrl('x')).toBeNull();
  });

  test('keys cannot escape the root or carry odd characters', async () => {
    const s = new LocalStorage(mkdtempSync(join(tmpdir(), 'crk-storage-')));
    for (const bad of ['../etc/passwd', '/abs', 'a//b', 'x;rm', 'ü.png', '']) {
      expect(() => assertKey(bad), bad).toThrow();
      await expect(s.put(bad, PNG, 'image/png')).rejects.toThrow();
    }
  });

  test('sniffing and allowlists: bytes decide the type; image/* patterns match', () => {
    expect(sniffMime(PNG)).toBe('image/png');
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMime(new TextEncoder().encode('%PDF-1.7\n'))).toBe('application/pdf');
    expect(sniffMime(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(
      'image/svg+xml',
    );
    expect(sniffMime(new TextEncoder().encode('MZ\x90\x00'))).toBeNull();
    expect(isAllowedType('image/png', ['image/*'])).toBe(true);
    expect(isAllowedType('image/png', ['image/jpeg'])).toBe(false);
    expect(isAllowedType('application/pdf', ['image/*', 'application/pdf'])).toBe(true);
    expect(extensionFor('image/webp')).toBe('webp');
    expect(extensionFor('application/x-msdownload')).toBe('bin');
  });

  describe('s3 adapter against an in-process S3-compatible server', () => {
    // A minimal path-style S3: PUT/GET/HEAD/DELETE on /<bucket>/<key>. Signatures are not verified —
    // this proves our adapter speaks the protocol Bun's client emits, not AWS's auth.
    const objects = new Map<string, { body: Uint8Array; type: string }>();
    const requests: string[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        requests.push(`${req.method} ${url.pathname}`);
        if (!url.pathname.startsWith('/bk/')) return new Response('wrong bucket', { status: 404 });
        const key = url.pathname.slice(4);
        if (req.method === 'PUT') {
          objects.set(key, {
            body: new Uint8Array(await req.arrayBuffer()),
            type: req.headers.get('content-type') ?? 'application/octet-stream',
          });
          return new Response('', { headers: { ETag: '"1"' } });
        }
        const o = objects.get(key);
        if (req.method === 'HEAD')
          return o
            ? new Response('', {
                headers: { 'content-length': String(o.body.byteLength), 'content-type': o.type },
              })
            : new Response('', { status: 404 });
        if (req.method === 'GET')
          return o
            ? new Response(o.body, { headers: { 'content-type': o.type } })
            : new Response('', { status: 404 });
        if (req.method === 'DELETE') {
          objects.delete(key);
          return new Response('', { status: 204 });
        }
        return new Response('', { status: 405 });
      },
    });
    afterAll(() => server.stop(true));

    test('put/get/exists/delete round-trip, path-style URLs, public URL when a base is configured', async () => {
      const s = new S3Storage({
        endpoint: `http://127.0.0.1:${server.port}`,
        bucket: 'bk',
        accessKeyId: 'k',
        secretAccessKey: 's',
        publicBaseUrl: 'https://cdn.example.test/',
      });
      await s.put('t1/2026/09/a.png', PNG, 'image/png');
      expect(await s.exists('t1/2026/09/a.png')).toBe(true);
      const got = await s.get('t1/2026/09/a.png');
      expect(Array.from(got?.bytes ?? [])).toEqual(Array.from(PNG));
      expect(got?.contentType).toBe('image/png');
      expect(s.publicUrl('t1/2026/09/a.png')).toBe('https://cdn.example.test/t1/2026/09/a.png');
      await s.delete('t1/2026/09/a.png');
      expect(await s.exists('t1/2026/09/a.png')).toBe(false);
      expect(await s.get('t1/2026/09/a.png')).toBeNull();
      expect(requests.some((r) => r === 'PUT /bk/t1/2026/09/a.png')).toBe(true);
    });
  });
});
