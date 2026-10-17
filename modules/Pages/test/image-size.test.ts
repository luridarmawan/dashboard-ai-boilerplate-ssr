import { describe, expect, test } from 'bun:test';
import { imageSize } from '../api/image-size.ts';
import { makePng } from './fixtures/png.ts';

/** og:image:width/height come from these headers — every format the upload accepts. */
const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );

describe('imageSize', () => {
  test('PNG (a real one)', () => {
    expect(imageSize(makePng(1200, 630))).toEqual({ width: 1200, height: 630 });
  });

  test('GIF', () => {
    expect(imageSize(bytes('GIF89a', [0x58, 0x02, 0x76, 0x02]))).toEqual({
      width: 600,
      height: 630,
    });
  });

  test('JPEG: skips APP segments to the SOF', () => {
    const jpeg = bytes(
      [0xff, 0xd8],
      [0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46], // APP0, 4 bytes of payload
      [0xff, 0xc2, 0x00, 0x11, 0x08, 0x02, 0x76, 0x04, 0xb0, 0x03], // SOF2: 630 high, 1200 wide
      new Array(12).fill(0),
    );
    expect(imageSize(jpeg)).toEqual({ width: 1200, height: 630 });
  });

  test('WebP: lossy, lossless and extended', () => {
    const riff = (chunk: string, body: number[]) =>
      bytes('RIFF', [0, 0, 0, 0], 'WEBP', chunk, [0, 0, 0, 0], body, new Array(16).fill(0));
    // VP8: 3-byte frame tag + start code, then 14-bit width/height (LE)
    expect(imageSize(riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 0xb0, 0x04, 0x76, 0x02]))).toEqual({
      width: 1200,
      height: 630,
    });
    // VP8L: signature 0x2f, then (w-1) | (h-1) << 14 in 28 bits
    const bits = (1200 - 1) | ((630 - 1) << 14);
    expect(
      imageSize(
        riff('VP8L', [
          0x2f,
          bits & 0xff,
          (bits >> 8) & 0xff,
          (bits >> 16) & 0xff,
          (bits >> 24) & 0xff,
        ]),
      ),
    ).toEqual({ width: 1200, height: 630 });
    // VP8X: flags + reserved, then 24-bit (w-1), (h-1)
    expect(imageSize(riff('VP8X', [0, 0, 0, 0, 0xaf, 0x04, 0x00, 0x75, 0x02, 0x00]))).toEqual({
      width: 1200,
      height: 630,
    });
  });

  test('anything else is null, never a throw', () => {
    for (const b of [
      new Uint8Array(),
      bytes('<svg>'),
      bytes('%PDF-1.7'),
      bytes([0xff, 0xd8, 0x00]),
    ])
      expect(imageSize(b)).toBeNull();
  });
});
