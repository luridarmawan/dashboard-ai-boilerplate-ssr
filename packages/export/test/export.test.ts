import { describe, expect, test } from 'bun:test';
import { inflateRawSync } from 'node:zlib';
import {
  type Column,
  columnLetter,
  crc32,
  exportBody,
  exportFormat,
  exportResponse,
  fileSlug,
  type Sheet,
  sheetName,
  toCsv,
  toXlsx,
} from '../src/index.ts';

/** Reads a ZIP through its central directory: name → bytes, CRC checked. */
function unzip(buf: Uint8Array): Map<string, Uint8Array> {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const end = buf.length - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(at, true)).toBe(0x02014b50);
    const crc = v.getUint32(at + 16, true);
    const size = v.getUint32(at + 20, true);
    const nameLen = v.getUint16(at + 28, true);
    const local = v.getUint32(at + 42, true);
    const name = new TextDecoder().decode(buf.subarray(at + 46, at + 46 + nameLen));
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = new Uint8Array(inflateRawSync(buf.subarray(start, start + size)));
    expect(crc32(data)).toBe(crc);
    out.set(name, data);
    at += 46 + nameLen;
  }
  return out;
}
const text = (files: Map<string, Uint8Array>, name: string) =>
  new TextDecoder().decode(files.get(name));

interface Person {
  name: string;
  nik: string;
  phone: string | null;
  born: string | null;
  joined: Date;
  score: number | null;
  active: boolean;
}
const columns: Column<Person>[] = [
  { header: 'Name', value: (p) => p.name },
  { header: 'NIK', value: (p) => p.nik },
  { header: 'Phone', value: (p) => p.phone },
  { header: 'Born', value: (p) => p.born, type: 'date' },
  { header: 'Joined', value: (p) => p.joined, type: 'datetime' },
  { header: 'Score', value: (p) => p.score, type: 'number' },
  { header: 'Active', value: (p) => p.active, type: 'boolean' },
];
const rows: Person[] = [
  {
    name: 'Siti "Ana", Jr.',
    nik: '3174012345678901',
    phone: '+62 812-3456',
    born: '1990-05-17',
    joined: new Date('2026-10-18T17:30:00Z'),
    score: 287.5,
    active: true,
  },
  {
    name: '=HYPERLINK("x")',
    nik: '0012',
    phone: null,
    born: null,
    joined: new Date('2026-01-01T00:00:00Z'),
    score: null,
    active: false,
  },
];
const sheet: Sheet<Person> = {
  name: 'Peserta: [2026]',
  heading: ['Liga <Hedef> & co', 'Diekspor 2026-10-19'],
  columns,
  rows,
  timeZone: 'Asia/Jakarta',
  booleanText: ['Ya', ''],
};

describe('@core/export', () => {
  test('format parameter: known values only, csv by default', () => {
    expect(exportFormat('XLSX')).toBe('xlsx');
    expect(exportFormat('csv')).toBe('csv');
    expect(exportFormat('pdf')).toBe('csv');
    expect(exportFormat(null, 'xlsx')).toBe('xlsx');
  });

  test('helpers: column letters, sheet names, file slugs', () => {
    expect([0, 25, 26, 51, 52, 701, 702].map(columnLetter)).toEqual([
      'A',
      'Z',
      'AA',
      'AZ',
      'BA',
      'ZZ',
      'AAA',
    ]);
    expect(sheetName('Peserta: [2026]')).toBe('Peserta   2026');
    expect(sheetName('')).toBe('Sheet1');
    expect(sheetName('x'.repeat(40))).toHaveLength(31);
    expect(fileSlug('Liga Hédef — Riau 2026')).toBe('liga-hedef-riau-2026');
    expect(fileSlug('***')).toBe('export');
  });

  test('CSV: RFC 4180 quoting, typed cells, formula guard that spares phone numbers', () => {
    const csv = toCsv(sheet);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Name,NIK,Phone,Born,Joined,Score,Active');
    // Joined is shown in Asia/Jakarta: 17:30Z → 00:30 next day.
    expect(lines[1]).toBe(
      '"Siti ""Ana"", Jr.",3174012345678901,+62 812-3456,1990-05-17,2026-10-19 00:30,287.5,Ya',
    );
    expect(lines[2]).toBe(`"'=HYPERLINK(""x"")",0012,,,2026-01-01 07:00,,`);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(toCsv({ columns, rows: [{ ...rows[1], name: '-cmd' } as Person] })).toContain("'-cmd");
  });

  test('CSV body starts with a byte-order mark; XLSX body is a ZIP', () => {
    const csv = exportBody(sheet, 'csv');
    expect([...csv.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const xlsx = exportBody(sheet, 'xlsx');
    expect([...xlsx.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  test('XLSX: package parts, sheet name, defined filter range', () => {
    const files = unzip(toXlsx(sheet));
    expect([...files.keys()].sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    const wb = text(files, 'xl/workbook.xml');
    expect(wb).toContain('<sheet name="Peserta   2026" sheetId="1" r:id="rId1"/>');
    // Heading (2 lines) + blank row → header on row 4, data on rows 5–6, columns A–G.
    expect(wb).toContain("'Peserta   2026'!$A$4:$G$6");
  });

  test('XLSX: text stays text, dates are serials, the header is frozen and filterable', () => {
    const ws = text(unzip(toXlsx(sheet)), 'xl/worksheets/sheet1.xml');
    expect(ws).toContain('<pane ySplit="4" topLeftCell="A5"');
    expect(ws).toContain('<autoFilter ref="A4:G6"/>');
    expect(ws).toContain(
      '<c r="A1" s="5" t="inlineStr"><is><t xml:space="preserve">Liga &lt;Hedef&gt; &amp; co</t></is></c>',
    );
    // NIK and a leading-zero code are inline strings with the text format.
    expect(ws).toContain(
      '<c r="B5" s="4" t="inlineStr"><is><t xml:space="preserve">3174012345678901</t></is></c>',
    );
    expect(ws).toContain('<t xml:space="preserve">0012</t>');
    // 1990-05-17 = serial 33010; 2026-10-19 00:30 Jakarta = 46314 + 0.5/24.
    expect(ws).toContain('<c r="D5" s="2"><v>33010</v></c>');
    expect(ws).toMatch(/<c r="E5" s="3"><v>46314\.0208333/);
    expect(ws).toContain('<c r="F5"><v>287.5</v></c>');
    expect(ws).toContain('<c r="G5" t="b"><v>1</v></c>');
    expect(ws).toContain('<c r="G6" t="b"><v>0</v></c>');
    // Empty values write no cell at all.
    expect(ws).not.toContain('r="C6"');
    expect(ws).not.toContain('r="F6"');
    // A formula-looking text is still just text in XLSX: no <f>, no apostrophe.
    expect(ws).not.toContain('<f>');
    expect(ws).toContain('<t xml:space="preserve">=HYPERLINK(&quot;x&quot;)</t>');
  });

  test('XLSX: characters XML cannot carry are dropped; same input gives same bytes', () => {
    const s: Sheet<{ v: string }> = {
      columns: [{ header: 'v', value: (r) => r.v }],
      rows: [{ v: 'a\u0001b' }],
    };
    const ws = text(unzip(toXlsx(s)), 'xl/worksheets/sheet1.xml');
    expect(ws).toContain('<t xml:space="preserve">ab</t>');
    expect(toXlsx(s)).toEqual(toXlsx(s));
  });

  test('response: content type, attachment name with a UTF-8 fallback, no-store', async () => {
    const res = exportResponse(sheet, 'xlsx', 'peserta-liga-é');
    expect(res.headers.get('content-type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="peserta-liga-_.xlsx"; filename*=UTF-8''peserta-liga-%C3%A9.xlsx`,
    );
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(500);
  });
});
