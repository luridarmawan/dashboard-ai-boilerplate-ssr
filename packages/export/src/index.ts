/**
 * Tabular export for core and modules: describe the columns once, get CSV or XLSX.
 *
 *   const sheet = { name: 'Products', columns: [{ header: 'Name', value: (p) => p.name }], rows };
 *   return exportResponse(sheet, exportFormat(url.searchParams.get('format')), 'products');
 *
 * Pure functions, no I/O and no third-party dependency: usable from an API route, a SvelteKit
 * `+server.ts`, a scheduled job or a CLI. Who may read the rows is the caller's decision.
 */
import { toCsv } from './csv.ts';
import { type ExportFormat, MIME, type Sheet } from './sheet.ts';
import { toXlsx } from './xlsx.ts';

export { toCsv } from './csv.ts';
export {
  type Column,
  type ColumnType,
  cellText,
  EXPORT_FORMATS,
  type ExportFormat,
  exportFormat,
  fileSlug,
  MIME,
  type Sheet,
} from './sheet.ts';
export { columnLetter, sheetName, toXlsx } from './xlsx.ts';
export { crc32, type ZipEntry, zip } from './zip.ts';

/** The file body of `sheet` in `format`. CSV starts with a byte-order mark so Excel reads UTF-8. */
export function exportBody<R>(sheet: Sheet<R>, format: ExportFormat): Uint8Array<ArrayBuffer> {
  return format === 'xlsx' ? toXlsx(sheet) : new TextEncoder().encode(`\uFEFF${toCsv(sheet)}`);
}

/**
 * A download response: the body, its content type, `attachment` with the file name
 * (`<baseName>.<format>`, with an RFC 5987 `filename*` for non-ASCII names) and `no-store`,
 * because exports usually hold personal data.
 */
export function exportResponse<R>(
  sheet: Sheet<R>,
  format: ExportFormat,
  baseName: string,
): Response {
  const file = `${baseName}.${format}`;
  const ascii = file.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return new Response(exportBody(sheet, format), {
    headers: {
      'content-type': MIME[format],
      'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file)}`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
