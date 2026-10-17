import { type FileRow, fileUrl, findFile } from '@app/api/files';
import { imageSize } from './image-size.ts';

/**
 * Featured images of pages. Each one is a PUBLIC row in core `files`, stored through
 * `storeUpload()` like any upload, with its pixel size in `meta` (read once at upload). Visitors
 * and social crawlers never fetch it from `/v1/files/<id>/content`: that route needs the tenant
 * named in `X-Client-ID`, which a crawler does not send. They get `/v1/m/pages/media/<id>`, which
 * resolves the site tenant the way `/resolve` does and only serves the image of a PUBLISHED page.
 */
export const FEATURED_KIND = 'pages.featured';

/** What Facebook, X, LinkedIn and WhatsApp all render as a link preview — no SVG, no AVIF. */
export const FEATURED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** Above every platform's preview limit is wasted bandwidth for nothing (X caps at 5 MB). */
export const FEATURED_MAX_BYTES = 5 * 1024 * 1024;

/** The public URL of a featured image (path only; the web makes it absolute for og:image). */
export const mediaPath = (fileId: string) => `/v1/m/pages/media/${fileId}`;

export interface FeaturedMeta {
  readonly width: number | null;
  readonly height: number | null;
  readonly mime: string;
}

/** The featured image row of a tenant, or null when it is gone or is not a featured image. */
export async function featuredFile(clientId: string, id: string): Promise<FileRow | null> {
  const row = await findFile(clientId, id);
  return row && row.kind === FEATURED_KIND ? row : null;
}

export function featuredMeta(row: FileRow): FeaturedMeta {
  const meta = (row.meta ?? {}) as { width?: unknown; height?: unknown };
  const n = (v: unknown) => (typeof v === 'number' && v > 0 ? v : null);
  return { width: n(meta.width), height: n(meta.height), mime: row.mime };
}

/** Where the DASHBOARD shows the image (any page state): the core file route, signed-in. */
export const adminUrl = (row: FileRow) => fileUrl(row);

/** Pixel size from the uploaded bytes; null when the header is not one we can read. */
export async function sizeOf(file: Blob) {
  return imageSize(new Uint8Array(await file.arrayBuffer()));
}
