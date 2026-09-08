import { promises as fs, mkdirSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { env } from '@core/config';

/**
 * `@core/storage` — where uploaded bytes live (PRD Q-9, Q-16). One interface, two adapters:
 *
 *   local  files under UPLOADS_DIR (a mapped volume in production, Q-9) — the default
 *   s3     any S3-compatible bucket (AWS, MinIO, R2, Spaces, …) through Bun's built-in S3 client,
 *          chosen with STORAGE_DRIVER=s3 + S3_* in the environment
 *
 * Keys are opaque, tenant-prefixed paths decided by the API (`<clientId>/<yyyy>/<mm>/<id>.<ext>`);
 * an adapter never interprets them. Metadata (owner, mime, size, visibility) lives in the `files`
 * table, not in the store: the store is bytes, the database is truth (§4.3).
 */

export interface StoredObject {
  readonly bytes: Uint8Array;
  readonly contentType: string | null;
}

export interface StorageAdapter {
  readonly driver: 'local' | 's3';
  put(key: string, data: Uint8Array | ArrayBuffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /**
   * A URL a browser can fetch directly, when the store can hand one out (public S3 buckets or a
   * CDN in front). Null means "serve through the API" — the default, and always right for private files.
   */
  publicUrl(key: string): string | null;
}

const KEY_RE = /^[a-z0-9][a-z0-9/_.-]{0,254}$/i;

/** Keys are validated everywhere: no absolute paths, no `..`, no odd characters. */
export function assertKey(key: string): void {
  if (!KEY_RE.test(key) || key.includes('..') || key.includes('//'))
    throw new Error(`storage: kunci "${key}" tidak valid`);
}

// ---------------------------------------------------------------------------------------------
// local
// ---------------------------------------------------------------------------------------------
export class LocalStorage implements StorageAdapter {
  readonly driver = 'local' as const;
  constructor(readonly root: string) {}

  private pathOf(key: string): string {
    assertKey(key);
    const full = normalize(join(this.root, key));
    const base = normalize(this.root).replace(/[\\/]+$/, '') + sep;
    if (!full.startsWith(base)) throw new Error(`storage: kunci "${key}" keluar dari root`);
    return full;
  }

  async put(key: string, data: Uint8Array | ArrayBuffer, contentType: string): Promise<void> {
    const path = this.pathOf(key);
    mkdirSync(dirname(path), { recursive: true });
    await Bun.write(path, data);
    // The content type travels with the object like on S3, so `get` needs no database lookup.
    await Bun.write(`${path}.meta`, JSON.stringify({ contentType }));
  }

  async get(key: string): Promise<StoredObject | null> {
    const path = this.pathOf(key);
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    let contentType: string | null = null;
    try {
      contentType =
        (JSON.parse(await Bun.file(`${path}.meta`).text()) as { contentType?: string })
          .contentType ?? null;
    } catch {
      contentType = null;
    }
    return { bytes: new Uint8Array(await file.arrayBuffer()), contentType };
  }

  async delete(key: string): Promise<void> {
    const path = this.pathOf(key);
    await fs.rm(path, { force: true });
    await fs.rm(`${path}.meta`, { force: true });
  }

  async exists(key: string): Promise<boolean> {
    return Bun.file(this.pathOf(key)).exists();
  }

  publicUrl(_key: string): string | null {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// s3 (Bun built-in client — path-style against any endpoint, SigV4 signed)
// ---------------------------------------------------------------------------------------------
export interface S3Options {
  readonly endpoint: string;
  readonly bucket: string;
  readonly region?: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Base URL of a public bucket / CDN; when set, `publicUrl(key)` = `${publicBaseUrl}/${key}`. */
  readonly publicBaseUrl?: string | null;
  readonly virtualHostedStyle?: boolean;
}

export class S3Storage implements StorageAdapter {
  readonly driver = 's3' as const;
  private readonly client: Bun.S3Client;
  constructor(private readonly opts: S3Options) {
    this.client = new Bun.S3Client({
      endpoint: opts.endpoint,
      bucket: opts.bucket,
      region: opts.region ?? 'auto',
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
      virtualHostedStyle: opts.virtualHostedStyle ?? false,
    });
  }

  async put(key: string, data: Uint8Array | ArrayBuffer, contentType: string): Promise<void> {
    assertKey(key);
    await this.client.write(key, data, { type: contentType });
  }

  async get(key: string): Promise<StoredObject | null> {
    assertKey(key);
    const file = this.client.file(key);
    if (!(await file.exists())) return null;
    const stat = await file.stat().catch(() => null);
    return {
      bytes: new Uint8Array(await file.arrayBuffer()),
      contentType: stat?.type ?? null,
    };
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    await this.client.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    assertKey(key);
    return this.client.exists(key);
  }

  publicUrl(key: string): string | null {
    if (!this.opts.publicBaseUrl) return null;
    return `${this.opts.publicBaseUrl.replace(/\/+$/, '')}/${key}`;
  }
}

// ---------------------------------------------------------------------------------------------
// factory + helpers
// ---------------------------------------------------------------------------------------------
let cached: StorageAdapter | null = null;

/** The adapter chosen by the environment (STORAGE_DRIVER); built once per process. */
export function storage(): StorageAdapter {
  cached ??= storageFromEnv();
  return cached;
}

export function storageFromEnv(): StorageAdapter {
  const e = env();
  if (e.STORAGE_DRIVER === 's3') {
    return new S3Storage({
      endpoint: e.S3_ENDPOINT ?? '',
      bucket: e.S3_BUCKET ?? '',
      region: e.S3_REGION,
      accessKeyId: e.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: e.S3_SECRET_ACCESS_KEY ?? '',
      publicBaseUrl: e.S3_PUBLIC_URL ?? null,
      virtualHostedStyle: e.S3_VIRTUAL_HOSTED_STYLE,
    });
  }
  return new LocalStorage(e.UPLOADS_DIR);
}

/** For tests: forget the cached adapter so the next call re-reads the environment. */
export function resetStorageCache(): void {
  cached = null;
}

/** Extension for a MIME type we know; `bin` otherwise. */
export function extensionFor(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/x-icon': 'ico',
    'image/vnd.microsoft.icon': 'ico',
    'application/pdf': 'pdf',
    'text/plain': 'txt',
    'text/csv': 'csv',
    'application/json': 'json',
    'application/zip': 'zip',
  };
  return map[mime] ?? 'bin';
}

/**
 * What the first bytes say the file is (magic numbers) for the formats we can recognise; null when
 * unknown. The API refuses an upload whose declared type is an image/pdf but whose bytes disagree.
 */
export function sniffMime(bytes: Uint8Array): string | null {
  const b = bytes;
  const startsWith = (...sig: number[]) => sig.every((v, i) => b[i] === v);
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (
    startsWith(0x52, 0x49, 0x46, 0x46) &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
    return 'image/webp';
  if (startsWith(0x25, 0x50, 0x44, 0x46, 0x2d)) return 'application/pdf';
  if (startsWith(0x50, 0x4b, 0x03, 0x04)) return 'application/zip';
  if (startsWith(0x00, 0x00, 0x01, 0x00)) return 'image/x-icon';
  const head = new TextDecoder().decode(b.slice(0, 512)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg')))
    return 'image/svg+xml';
  return null;
}

/** `image/*`-style patterns and exact types, case-insensitive. */
export function isAllowedType(mime: string, allowed: readonly string[]): boolean {
  const m = mime.toLowerCase();
  return allowed.some((a) => {
    const p = a.trim().toLowerCase();
    if (!p) return false;
    if (p === '*/*') return true;
    if (p.endsWith('/*')) return m.startsWith(p.slice(0, -1));
    return m === p;
  });
}

/** Content types a browser may render inline without becoming an XSS vector. */
export const INLINE_SAFE = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'application/pdf',
]);
