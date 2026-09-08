import { and, eq, isNull, newId, schema, unsafeAcrossTenants } from '@core/db';
import { logger } from '@core/logger';
import { extensionFor, isAllowedType, sniffMime, storage } from '@core/storage';
import { settings } from './services.ts';

/**
 * Upload service (PRD Q-16) — the ONE way bytes enter the store. Core routes and modules call
 * `storeUpload()`; it validates size and type against the tenant's settings, sniffs the content
 * (a `.png` that is not a PNG is refused), writes to the configured adapter (local volume or S3)
 * and records the row in `files`. Metadata is tenant data; bytes are keyed by tenant too.
 */

export type FileRow = typeof schema.files.$inferSelect;

export interface StoreUploadInput {
  readonly clientId: string;
  readonly userId: string | null;
  readonly file: File | Blob;
  readonly name?: string;
  /** `generic` | `theme-logo` | `avatar` | `<ns>.<purpose>` — filters and per-kind rules. */
  readonly kind?: string;
  readonly visibility?: 'public' | 'private';
  readonly meta?: Record<string, unknown> | null;
  /** Override the tenant's allowlist for this call (e.g. logos: images only). */
  readonly allowedTypes?: readonly string[];
  /** Override the tenant's size cap (bytes). */
  readonly maxBytes?: number;
}

export type StoreUploadResult =
  | { readonly ok: true; readonly row: FileRow }
  | {
      readonly ok: false;
      readonly code: 'too_large' | 'type_not_allowed' | 'content_mismatch' | 'empty';
      readonly message: string;
    };

const SNIFFABLE = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'application/pdf',
  'application/zip',
]);

export async function uploadLimits(clientId: string | null) {
  const mb = (await settings.get<number | null>(clientId, 'files.max_size_mb')) ?? 10;
  const types = (await settings.get<string[] | null>(clientId, 'files.allowed_types')) ?? [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'application/pdf',
    'text/plain',
    'text/csv',
  ];
  return { maxBytes: Math.max(1, mb) * 1024 * 1024, allowedTypes: types };
}

export async function storeUpload(input: StoreUploadInput): Promise<StoreUploadResult> {
  const limits = await uploadLimits(input.clientId);
  const maxBytes = input.maxBytes ?? limits.maxBytes;
  const allowed = input.allowedTypes ?? limits.allowedTypes;
  const size = input.file.size;
  if (!size) return { ok: false, code: 'empty', message: 'Berkas kosong' };
  if (size > maxBytes)
    return {
      ok: false,
      code: 'too_large',
      message: `Berkas ${(size / 1_048_576).toFixed(1)} MB melebihi batas ${(maxBytes / 1_048_576).toFixed(0)} MB`,
    };
  const declared =
    (input.file.type || 'application/octet-stream').split(';')[0]?.trim().toLowerCase() ?? '';
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const sniffed = sniffMime(bytes);
  // The content decides the type when it can be recognised; the declaration is only a hint.
  const mime = sniffed ?? declared;
  if (!isAllowedType(mime, allowed))
    return {
      ok: false,
      code: 'type_not_allowed',
      message: `Tipe ${mime} tidak diizinkan (diizinkan: ${allowed.join(', ')})`,
    };
  if (sniffed && SNIFFABLE.has(declared) && sniffed !== declared)
    return {
      ok: false,
      code: 'content_mismatch',
      message: `Isi berkas adalah ${sniffed}, bukan ${declared} seperti yang dinyatakan`,
    };
  if (!sniffed && SNIFFABLE.has(declared))
    return {
      ok: false,
      code: 'content_mismatch',
      message: `Isi berkas tidak dikenali sebagai ${declared}`,
    };

  const id = newId();
  const now = new Date();
  const key = `${input.clientId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${id}.${extensionFor(mime)}`;
  const store = storage();
  await store.put(key, bytes, mime);
  const sha256 = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
  const name =
    (input.name ?? (input.file instanceof File ? input.file.name : '') ?? 'file').slice(0, 255) ||
    'file';
  await unsafeAcrossTenants()
    .insert(schema.files)
    .values({
      id,
      client_id: input.clientId,
      user_id: input.userId,
      key,
      storage: store.driver,
      name,
      mime,
      size,
      sha256,
      kind: (input.kind ?? 'generic').slice(0, 64),
      visibility: input.visibility ?? 'private',
      meta: input.meta ?? null,
    });
  const [row] = await unsafeAcrossTenants()
    .select()
    .from(schema.files)
    .where(eq(schema.files.id, id))
    .limit(1);
  return { ok: true, row: row as FileRow };
}

/** Metadata of a live file in a tenant, or null. */
export async function findFile(clientId: string, id: string): Promise<FileRow | null> {
  const [row] = await unsafeAcrossTenants()
    .select()
    .from(schema.files)
    .where(
      and(
        eq(schema.files.client_id, clientId),
        eq(schema.files.id, id),
        isNull(schema.files.deleted_at),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The bytes + content type of a file, from whichever adapter stored it. */
export async function readFile(row: FileRow) {
  return storage().get(row.key);
}

/** Soft-delete the row and remove the object; a failed object removal is logged, the row still goes. */
export async function removeFile(row: FileRow): Promise<void> {
  await unsafeAcrossTenants()
    .update(schema.files)
    .set({ deleted_at: new Date() })
    .where(eq(schema.files.id, row.id));
  try {
    await storage().delete(row.key);
  } catch (err) {
    logger.warn('files: object removal failed', {
      id: row.id,
      key: row.key,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Where a browser fetches this file: the store's public URL when it has one, else the API. */
export function fileUrl(row: Pick<FileRow, 'id' | 'key' | 'visibility'>): string {
  if (row.visibility === 'public') {
    const direct = storage().publicUrl(row.key);
    if (direct) return direct;
  }
  return `/v1/files/${row.id}/content`;
}
