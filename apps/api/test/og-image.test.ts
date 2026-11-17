import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { OG_HEIGHT, OG_WIDTH, ogCardKey, toOgImage } from '../src/lib/og-image.ts';

const solid = (width: number, height: number, format: 'png' | 'jpeg' | 'webp' | 'gif' = 'png') =>
  sharp({ create: { width, height, channels: 3, background: '#5d4037' } })
    [format]()
    .toBuffer()
    .then((b) => new Uint8Array(b));

async function sizeOf(bytes: Uint8Array) {
  const m = await sharp(bytes).metadata();
  return { width: m.width, height: m.height, format: m.format };
}

describe('toOgImage', () => {
  test.each([
    ['portrait poster', 1024, 1536],
    ['square logo', 512, 512],
    ['wide banner', 3000, 600],
    ['already 1.91:1', 1910, 1000],
    ['tiny', 40, 30],
  ])('%s → 1200 × 630 JPEG', async (_name, w, h) => {
    const card = await toOgImage(await solid(w, h));
    expect(card).not.toBeNull();
    expect(await sizeOf(card as Uint8Array)).toEqual({
      width: OG_WIDTH,
      height: OG_HEIGHT,
      format: 'jpeg',
    });
  });

  test('JPEG, WebP and GIF are read too', async () => {
    for (const f of ['jpeg', 'webp', 'gif'] as const) {
      const card = await toOgImage(await solid(800, 800, f));
      expect(card && (await sizeOf(card)).width).toBe(OG_WIDTH);
    }
  });

  test('transparent PNG is flattened, not black', async () => {
    const png = new Uint8Array(
      await sharp({
        create: {
          width: 400,
          height: 400,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .png()
        .toBuffer(),
    );
    const card = (await toOgImage(png)) as Uint8Array;
    const { data } = await sharp(card)
      .extract({ left: 600, top: 315, width: 1, height: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(200);
  });

  test('not an image → null', async () => {
    expect(await toOgImage(new TextEncoder().encode('<html>nope</html>'))).toBeNull();
    expect(await toOgImage(new Uint8Array())).toBeNull();
  });

  test('cache key is versioned and a valid storage key', () => {
    expect(ogCardKey('01a1e816-f5dc-70a0-8cf0-838aa551bb8e')).toBe(
      'og/01a1e816-f5dc-70a0-8cf0-838aa551bb8e-v1.jpg',
    );
  });
});
