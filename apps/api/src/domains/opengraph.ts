import { errorResponses, fail, Id } from '@core/contracts';
import { and, eq, isNull, schema, unsafeAcrossTenants } from '@core/db';
import { logger } from '@core/logger';
import { storage } from '@core/storage';
import { Elysia, t } from 'elysia';
import { type FileRow, readFile } from '../files.ts';
import {
  loadSharp,
  OG_HEIGHT,
  OG_MIME,
  OG_SOURCE_TYPES,
  OG_VERSION,
  OG_WIDTH,
  ogCardKey,
  toOgImage,
} from '../lib/og-image.ts';
import { requestContext } from '../plugins/request-context.ts';

/**
 * `GET /v1/opengraph/:fileId` — the 1200 × 630 share card of a PUBLIC image (see lib/og-image).
 * Pages point og:image / twitter:image here instead of at the upload itself, so a link preview
 * looks the same whatever the user uploaded, and og:image:width/height are always known.
 *
 * Only `visibility = 'public'` rows of a decodable image type are served, from any tenant, with
 * no session and no `X-Client-ID` (crawlers send neither) — the same bytes anyone can already
 * fetch. Private files answer 404, exactly like a missing one.
 *
 * The card is made once and kept in storage under `og/<fileId>-<version>.jpg`; removing the file
 * removes it too (`removeOgCard` in lib/og-image). When it cannot be made (sharp not loadable on this host, a
 * corrupt upload) the original is served with a short cache, so the share still works.
 */
async function publicImage(id: string): Promise<FileRow | null> {
  const [row] = await unsafeAcrossTenants() // public files of any tenant: crawlers name no tenant
    .select()
    .from(schema.files)
    .where(
      and(
        eq(schema.files.id, id),
        eq(schema.files.visibility, 'public'),
        isNull(schema.files.deleted_at),
      ),
    )
    .limit(1);
  return row && OG_SOURCE_TYPES.has(row.mime) ? row : null;
}

/** One render per file at a time: a burst of crawlers on a fresh link shares the same work. */
const inFlight = new Map<string, Promise<Uint8Array | null>>();
let warnedNoSharp = false;

async function cardOf(row: FileRow): Promise<Uint8Array | null> {
  const key = ogCardKey(row.id);
  const cached = await storage().get(key);
  if (cached) return cached.bytes;
  let job = inFlight.get(row.id);
  if (!job) {
    job = (async () => {
      const original = await readFile(row);
      if (!original) return null;
      const card = await toOgImage(original.bytes);
      if (!card) {
        if (!warnedNoSharp && !(await loadSharp())) {
          warnedNoSharp = true;
          logger.warn('opengraph: sharp is not available, serving original images as share cards');
        }
        return null;
      }
      try {
        await storage().put(key, card, OG_MIME);
      } catch (err) {
        logger.warn('opengraph: card not cached', {
          id: row.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return card;
    })().finally(() => inFlight.delete(row.id));
    inFlight.set(row.id, job);
  }
  return job;
}

const body = (bytes: Uint8Array) => new Blob([bytes as unknown as ArrayBuffer]);

export const opengraphDomain = new Elysia({
  name: 'opengraph',
  prefix: '/opengraph',
  tags: ['files'],
})
  .use(requestContext)
  .get(
    '/:fileId',
    async ({ params, set, requestId }) => {
      const row = await publicImage(params.fileId);
      if (!row) {
        set.status = 404;
        return fail('not_found', 'Gambar tidak ditemukan', requestId);
      }
      const card = await cardOf(row);
      if (card) {
        return new Response(body(card), {
          headers: {
            'content-type': OG_MIME,
            'content-length': String(card.byteLength),
            'x-content-type-options': 'nosniff',
            // A new upload is a new id, so the card of an id never changes.
            'cache-control': 'public, max-age=86400',
            etag: `"${row.id}-${OG_VERSION}"`,
            'x-request-id': requestId,
          },
        });
      }
      // Fallback: the picture as uploaded. Short cache, so a later fix (sharp installed) shows.
      const original = await readFile(row);
      if (!original) {
        set.status = 404;
        return fail('not_found', 'Isi berkas tidak ada di penyimpanan', requestId);
      }
      return new Response(body(original.bytes), {
        headers: {
          'content-type': row.mime,
          'content-length': String(original.bytes.byteLength),
          'x-content-type-options': 'nosniff',
          'cache-control': 'public, max-age=300',
          'x-og-fallback': 'original',
          'x-request-id': requestId,
        },
      });
    },
    {
      params: t.Object({ fileId: Id }),
      response: { 200: t.Unknown(), ...errorResponses },
      detail: {
        summary: 'Share card of a public image',
        description: `Public, no sign-in, no tenant header. The ${OG_WIDTH} × ${OG_HEIGHT} JPEG of a public JPEG/PNG/WebP/GIF upload for og:image and twitter:image: close-to-1.91:1 pictures are cropped to fit, others are shown whole on a blurred copy of themselves. Private or missing files answer 404.`,
      },
    },
  );
