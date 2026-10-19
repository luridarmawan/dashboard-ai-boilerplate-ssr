import { deflateRawSync } from 'node:zlib';

/**
 * The smallest ZIP writer an XLSX needs: deflated entries, UTF-8 names, no ZIP64 (an export
 * stays far below 4 GB and 65,535 entries). Entry times are fixed at 1980-01-01, so the same
 * input always gives the same bytes.
 */
export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++)
    c = (CRC_TABLE[(c ^ (data[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DOS date of 1980-01-01 (year 0, month 1, day 1); time 00:00:00. */
const DOS_DATE = (1 << 5) | 1;
const DOS_TIME = 0;
/** General purpose flag bit 11: names are UTF-8. */
const UTF8 = 0x0800;

export function zip(entries: readonly ZipEntry[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const packed = new Uint8Array(deflateRawSync(e.data));
    const crc = crc32(e.data);

    const local = new Uint8Array(30 + name.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, UTF8, true);
    l.setUint16(8, 8, true);
    l.setUint16(10, DOS_TIME, true);
    l.setUint16(12, DOS_DATE, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, packed.length, true);
    l.setUint32(22, e.data.length, true);
    l.setUint16(26, name.length, true);
    l.setUint16(28, 0, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, UTF8, true);
    c.setUint16(10, 8, true);
    c.setUint16(12, DOS_TIME, true);
    c.setUint16(14, DOS_DATE, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, packed.length, true);
    c.setUint32(24, e.data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, packed);
    centrals.push(central);
    offset += local.length + packed.length;
  }
  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = new Uint8Array(22);
  const d = new DataView(end.buffer);
  d.setUint32(0, 0x06054b50, true);
  d.setUint16(8, entries.length, true);
  d.setUint16(10, entries.length, true);
  d.setUint32(12, cdSize, true);
  d.setUint32(16, offset, true);

  const out = new Uint8Array(offset + cdSize + end.length);
  let at = 0;
  for (const b of [...locals, ...centrals, end]) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}
