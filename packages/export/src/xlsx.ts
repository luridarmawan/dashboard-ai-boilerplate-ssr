import { type Column, cellText, clockOf, dayOf, type Sheet } from './sheet.ts';
import { zip } from './zip.ts';

/**
 * A one-sheet Office Open XML workbook (what Excel, LibreOffice and Google Sheets open as
 * `.xlsx`), written by hand: strings are inline (no shared-string table), five cell styles.
 *
 * What it gives over CSV: `text` cells stay text (a 16-digit identity number is not turned into
 * `3.17E+15`, a leading zero is kept), dates are real dates, the header row is bold, frozen and
 * filterable, and columns have a usable width.
 */

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** Cell style indexes in `styles.xml` below. */
const S = { plain: 0, header: 1, date: 2, datetime: 3, text: 4, title: 5 } as const;

/** Excel's cell limit; longer text is cut. */
const MAX_TEXT = 32_767;
/** Rows sampled when estimating a column's width. */
const WIDTH_SAMPLE = 1000;

/** Characters XML 1.0 cannot carry are dropped; the rest escaped. */
const xml = (s: string) =>
  s
    .replace(/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 0 → `A`, 25 → `Z`, 26 → `AA`. */
export function columnLetter(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Excel's serial day number (1900 date system) of a UTC wall clock. */
const serial = (y: number, m: number, d: number, h = 0, i = 0, s = 0) =>
  Date.UTC(y, m - 1, d, h, i, s) / 86_400_000 + 25_569;

/** Sheet names: at most 31 characters, none of `[]:*?/\`, not empty. */
export function sheetName(s: string | undefined): string {
  const n = (s ?? '')
    .replace(/[[\]:*?/\\]/g, ' ')
    .replace(/^'+|'+$/g, '')
    .trim()
    .slice(0, 31);
  return n || 'Sheet1';
}

const inline = (ref: string, s: string, style: number) =>
  `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(s.slice(0, MAX_TEXT))}</t></is></c>`;

function cell<R>(sheet: Sheet<R>, col: Column<R>, ref: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  switch (col.type ?? 'text') {
    case 'number': {
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
      return Number.isFinite(n) ? `<c r="${ref}"><v>${n}</v></c>` : '';
    }
    case 'date': {
      const d = dayOf(v);
      if (!d) return '';
      const n = serial(d.y, d.m, d.d);
      // Before 1900-03-01 Excel's serials are off by its 1900 leap-year bug: keep the text.
      return n >= 61
        ? `<c r="${ref}" s="${S.date}"><v>${n}</v></c>`
        : inline(ref, cellText(sheet, col, v), S.text);
    }
    case 'datetime': {
      const c = clockOf(v, sheet.timeZone ?? 'UTC');
      if (!c) return '';
      const n = serial(c.y, c.m, c.d, c.h, c.i, c.s);
      return n >= 61
        ? `<c r="${ref}" s="${S.datetime}"><v>${n}</v></c>`
        : inline(ref, cellText(sheet, col, v), S.text);
    }
    case 'boolean':
      return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
    default:
      return inline(ref, String(v), S.text);
  }
}

function widthOf<R>(sheet: Sheet<R>, col: Column<R>): number {
  if (col.width) return col.width;
  if (col.type === 'date') return Math.max(12, col.header.length + 2);
  if (col.type === 'datetime') return Math.max(17, col.header.length + 2);
  let w = col.header.length;
  for (const row of sheet.rows.slice(0, WIDTH_SAMPLE))
    w = Math.max(w, cellText(sheet, col, col.value(row)).length);
  return Math.min(60, Math.max(6, w + 2));
}

function worksheet<R>(sheet: Sheet<R>): string {
  const cols = sheet.columns;
  const heading = sheet.heading ?? [];
  // Heading lines, then one empty row, then the table.
  const headerRow = heading.length ? heading.length + 2 : 1;
  const lastCol = columnLetter(Math.max(0, cols.length - 1));
  const lastRow = headerRow + sheet.rows.length;
  const rows: string[] = [];
  heading.forEach((line, i) => {
    rows.push(`<row r="${i + 1}">${inline(`A${i + 1}`, line, i === 0 ? S.title : S.plain)}</row>`);
  });
  rows.push(
    `<row r="${headerRow}">${cols.map((c, i) => inline(`${columnLetter(i)}${headerRow}`, c.header, S.header)).join('')}</row>`,
  );
  sheet.rows.forEach((row, r) => {
    const n = headerRow + 1 + r;
    rows.push(
      `<row r="${n}">${cols.map((c, i) => cell(sheet, c, `${columnLetter(i)}${n}`, c.value(row))).join('')}</row>`,
    );
  });
  const widths = cols
    .map(
      (c, i) => `<col min="${i + 1}" max="${i + 1}" width="${widthOf(sheet, c)}" customWidth="1"/>`,
    )
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="${NS}" xmlns:r="${NS_R}">` +
    `<dimension ref="A1:${lastCol}${lastRow}"/>` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    (widths ? `<cols>${widths}</cols>` : '') +
    `<sheetData>${rows.join('')}</sheetData>` +
    (cols.length ? `<autoFilter ref="A${headerRow}:${lastCol}${lastRow}"/>` : '') +
    `</worksheet>`
  );
}

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<styleSheet xmlns="${NS}">` +
  `<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/></numFmts>` +
  `<fonts count="3"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font></fonts>` +
  `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills>` +
  `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="6">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="49" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

export function toXlsx<R>(sheet: Sheet<R>): Uint8Array<ArrayBuffer> {
  const name = sheetName(sheet.name);
  const headerRow = sheet.heading?.length ? sheet.heading.length + 2 : 1;
  const lastCol = columnLetter(Math.max(0, sheet.columns.length - 1));
  const lastRow = headerRow + sheet.rows.length;
  const quoted = `'${name.replace(/'/g, "''")}'`;
  const filter = sheet.columns.length
    ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">${xml(`${quoted}!$A$${headerRow}:$${lastCol}$${lastRow}`)}</definedName></definedNames>`
    : '';
  const head = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;
  const files: Record<string, string> = {
    '[Content_Types].xml':
      `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `</Types>`,
    '_rels/.rels':
      `${head}<Relationships xmlns="${NS_PKG_REL}">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
    'xl/workbook.xml':
      `${head}<workbook xmlns="${NS}" xmlns:r="${NS_R}">` +
      `<sheets><sheet name="${xml(name)}" sheetId="1" r:id="rId1"/></sheets>${filter}</workbook>`,
    'xl/_rels/workbook.xml.rels':
      `${head}<Relationships xmlns="${NS_PKG_REL}">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`,
    'xl/styles.xml': STYLES,
    'xl/worksheets/sheet1.xml': worksheet(sheet),
  };
  const enc = new TextEncoder();
  return zip(Object.entries(files).map(([n, s]) => ({ name: n, data: enc.encode(s) })));
}
