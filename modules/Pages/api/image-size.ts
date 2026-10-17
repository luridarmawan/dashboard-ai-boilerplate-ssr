/**
 * Pixel size of a PNG, JPEG, GIF or WebP from its header bytes — enough for `og:image:width` and
 * `og:image:height` (which let Facebook and LinkedIn render the card on the first share instead
 * of fetching the image first) and for reserving the image's box on the page. Pure, no decoding.
 */
export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

const be16 = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const le16 = (b: Uint8Array, i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
const be32 = (b: Uint8Array, i: number) =>
  (((b[i] ?? 0) << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0)) >>> 0;
const le24 = (b: Uint8Array, i: number) =>
  (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

export function imageSize(b: Uint8Array): ImageSize | null {
  const size = (width: number, height: number) =>
    width > 0 && height > 0 ? { width, height } : null;
  // PNG: signature, then the IHDR chunk carries width/height as big-endian u32.
  if (b.length >= 24 && be32(b, 0) === 0x89504e47 && ascii(b, 12, 4) === 'IHDR')
    return size(be32(b, 16), be32(b, 20));
  // GIF87a / GIF89a: logical screen size, little-endian u16.
  if (b.length >= 10 && ascii(b, 0, 3) === 'GIF') return size(le16(b, 6), le16(b, 8));
  // WebP: RIFF....WEBP, then one of three chunk formats.
  if (b.length >= 30 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const chunk = ascii(b, 12, 4);
    if (chunk === 'VP8 ') return size(le16(b, 26) & 0x3fff, le16(b, 28) & 0x3fff);
    if (chunk === 'VP8L') {
      const bits = (b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) << 24);
      return size((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    if (chunk === 'VP8X') return size(le24(b, 24) + 1, le24(b, 27) + 1);
    return null;
  }
  // JPEG: walk the segments until a start-of-frame marker (SOF0–SOF15 minus DHT/JPG/DAC).
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1] ?? 0;
      if (marker === 0xff) {
        i++;
        continue;
      }
      const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isSof) return size(be16(b, i + 7), be16(b, i + 5));
      i += 2 + be16(b, i + 2);
    }
  }
  return null;
}
