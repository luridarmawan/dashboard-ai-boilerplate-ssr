/**
 * Share-card images (Open Graph / X): any uploaded picture → one 1200 × 630 JPEG, the size every
 * network renders as a large card. Users upload whatever they have — tall posters, square logos,
 * huge camera shots — and networks crop or shrink those unpredictably. Here:
 *
 *   - close to 1.91:1 already (±15 %) → scaled to cover the card, the thin overflow cropped;
 *   - anything else → the WHOLE picture centred on a blurred, darkened copy of itself, so a
 *     poster's text is never cut off and the card has no flat bars;
 *   - small pictures are enlarged at most 2×, past that they would only turn to mush.
 *
 * Decoding is done by `sharp` (libvips), loaded lazily: where it cannot load — the single-file
 * binary of the Docker image cannot carry its native library — `loadSharp()` answers null and
 * callers serve the original instead, so a share never breaks for want of a resize.
 */
import { storage } from '@core/storage';
import type { Sharp, SharpOptions } from 'sharp';

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
export const OG_MIME = 'image/jpeg';
/** Bump when the rendering changes: cached cards are stored under this version. */
export const OG_VERSION = 'v1';
/** Types decoded into a card. SVG is not among them: it may carry scripts and has no pixels. */
export const OG_SOURCE_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
/** Decompression-bomb guard: ~50 MP is far beyond any camera photo a user uploads. */
const MAX_INPUT_PIXELS = 50_000_000;
/** How far from 1.91:1 a picture may be and still be cropped rather than framed. */
const CROP_TOLERANCE = 0.15;
const MAX_UPSCALE = 2;

type SharpFactory = (input?: Uint8Array, options?: SharpOptions) => Sharp;
let loading: Promise<SharpFactory | null> | null = null;

/** `sharp`, or null when its native library is not available on this host (logged once by the caller). */
export function loadSharp(): Promise<SharpFactory | null> {
  // The name goes through a variable so `bun build --compile` does not try to bundle the addon.
  const name = 'sharp';
  loading ??= import(name).then(
    (m) => (m.default ?? m) as SharpFactory,
    () => null,
  );
  return loading;
}

/** Test seam: forget the cached loader. */
export function resetSharpLoader(): void {
  loading = null;
}

/**
 * The share card of `bytes`, or null when it cannot be made (sharp missing, not an image, too
 * many pixels, corrupt file). Animated GIF/WebP: the first frame.
 */
export async function toOgImage(bytes: Uint8Array): Promise<Uint8Array | null> {
  const sharp = await loadSharp();
  if (!sharp) return null;
  try {
    const open = () =>
      sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, animated: false, failOn: 'error' })
        // EXIF orientation applied first, so phone photos are not sideways.
        .rotate();
    // Size AFTER orientation: a portrait photo stored landscape + EXIF counts as portrait.
    const oriented = await open().toBuffer({ resolveWithObject: true });
    const { width, height } = oriented.info;
    if (!width || !height) return null;

    const target = OG_WIDTH / OG_HEIGHT;
    const ratio = width / height;
    const out = (s: Sharp) =>
      s
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 82, progressive: true, mozjpeg: true })
        .toBuffer();

    if (Math.abs(ratio / target - 1) <= CROP_TOLERANCE) {
      return new Uint8Array(
        await out(open().resize(OG_WIDTH, OG_HEIGHT, { fit: 'cover', position: 'centre' })),
      );
    }

    const scale = Math.min(OG_WIDTH / width, OG_HEIGHT / height, MAX_UPSCALE);
    const fw = Math.max(1, Math.round(width * scale));
    const fh = Math.max(1, Math.round(height * scale));
    const [background, foreground] = await Promise.all([
      open()
        .resize(OG_WIDTH, OG_HEIGHT, { fit: 'cover', position: 'centre' })
        .flatten({ background: '#ffffff' })
        .blur(40)
        .modulate({ brightness: 0.6 })
        .toBuffer(),
      open().resize(fw, fh, { fit: 'fill' }).flatten({ background: '#ffffff' }).png().toBuffer(),
    ]);
    return new Uint8Array(
      await out(
        sharp(new Uint8Array(background)).composite([{ input: foreground, gravity: 'centre' }]),
      ),
    );
  } catch {
    return null;
  }
}

/** Where the card of a file is cached in storage. */
export const ogCardKey = (fileId: string) => `og/${fileId}-${OG_VERSION}.jpg`;

/** Drop a file's cached card; called when the file is removed. Never throws. */
export async function removeOgCard(fileId: string): Promise<void> {
  try {
    await storage().delete(ogCardKey(fileId));
  } catch {
    // Nothing cached, or the store is unreachable: an orphan card is harmless.
  }
}
