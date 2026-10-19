import { cellText, type Sheet } from './sheet.ts';

/**
 * RFC 4180 CSV, CRLF line ends. The heading lines are not written: CSV has one table and its
 * first line is the header row, which is what importers expect.
 *
 * Text cells that a spreadsheet would run as a formula (`=…`, `@…`, `+cmd…`) get a leading `'`
 * (CSV injection). A sign followed only by digits and phone punctuation (`+62 812-…`, `-5`) is
 * left alone, so phone numbers stay readable.
 */
const FORMULA = /^[=@\t\r]|^[+-](?![\d\s().-]*$)/;

const field = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function toCsv<R>(sheet: Sheet<R>): string {
  const lines = [sheet.columns.map((c) => field(c.header)).join(',')];
  for (const row of sheet.rows)
    lines.push(
      sheet.columns
        .map((c) => {
          const s = cellText(sheet, c, c.value(row));
          return field((c.type ?? 'text') === 'text' && FORMULA.test(s) ? `'${s}` : s);
        })
        .join(','),
    );
  return `${lines.join('\r\n')}\r\n`;
}
