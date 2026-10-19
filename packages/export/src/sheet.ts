/**
 * The one description of a table both writers read. A column says how to get a cell from a row
 * and what kind of value it holds; the kind decides how the cell is written, so a 16-digit
 * identity number stays text and a date stays a date in a spreadsheet.
 */

/**
 * - `text`     — written as text, never interpreted (identity numbers, phone numbers, codes)
 * - `number`   — a finite number; anything else becomes an empty cell
 * - `date`     — a calendar day: `Date` (its UTC day) or `YYYY-MM-DD…`
 * - `datetime` — a moment: `Date` or ISO string, shown in the sheet's `timeZone`
 * - `boolean`  — true/false; CSV writes `booleanText` when given
 */
export type ColumnType = 'text' | 'number' | 'date' | 'datetime' | 'boolean';

export interface Column<R> {
  readonly header: string;
  readonly value: (row: R) => unknown;
  /** Default `text`. */
  readonly type?: ColumnType;
  /** Width in characters (XLSX); estimated from the content when absent. */
  readonly width?: number;
}

export interface Sheet<R> {
  readonly columns: readonly Column<R>[];
  readonly rows: readonly R[];
  /** Worksheet name (XLSX). Trimmed to Excel's 31 characters, forbidden characters removed. */
  readonly name?: string;
  /** Lines written above the table in XLSX (e.g. the event name and the export date). */
  readonly heading?: readonly string[];
  /** IANA zone for `datetime` columns. Default `UTC`. */
  readonly timeZone?: string;
  /** Labels for `boolean` cells in CSV, e.g. `['Ya', '']`. Default `['true', 'false']`. */
  readonly booleanText?: readonly [string, string];
}

export type ExportFormat = 'csv' | 'xlsx';

export const EXPORT_FORMATS: readonly ExportFormat[] = ['csv', 'xlsx'];

/** `?format=` → a known format; anything else falls back to `fallback`. */
export function exportFormat(v: string | null | undefined, fallback: ExportFormat = 'csv') {
  const f = (v ?? '').trim().toLowerCase();
  return (EXPORT_FORMATS as readonly string[]).includes(f) ? (f as ExportFormat) : fallback;
}

export const MIME: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** A calendar day as `{y, m, d}`, or null. A `Date` counts by its UTC day. */
export function dayOf(v: unknown): { y: number; m: number; d: number } | null {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return { y: v.getUTCFullYear(), m: v.getUTCMonth() + 1, d: v.getUTCDate() };
  }
  const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim()) : null;
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

/** A moment's wall clock in `timeZone`, or null. */
export function clockOf(
  v: unknown,
  timeZone: string,
): { y: number; m: number; d: number; h: number; i: number; s: number } | null {
  const at = v instanceof Date ? v : typeof v === 'string' && v.trim() ? new Date(v) : null;
  if (!at || Number.isNaN(at.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const p = (t: string) => Number(parts.find((x) => x.type === t)?.value ?? 0);
  return { y: p('year'), m: p('month'), d: p('day'), h: p('hour'), i: p('minute'), s: p('second') };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** The text form of a cell, as CSV writes it and as XLSX measures column widths. */
export function cellText<R>(sheet: Sheet<R>, col: Column<R>, v: unknown): string {
  if (v === null || v === undefined) return '';
  switch (col.type ?? 'text') {
    case 'number':
      return typeof v === 'number' && Number.isFinite(v)
        ? String(v)
        : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
          ? v.trim()
          : '';
    case 'date': {
      const d = dayOf(v);
      return d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : '';
    }
    case 'datetime': {
      const c = clockOf(v, sheet.timeZone ?? 'UTC');
      return c ? `${c.y}-${pad(c.m)}-${pad(c.d)} ${pad(c.h)}:${pad(c.i)}` : '';
    }
    case 'boolean': {
      const [yes, no] = sheet.booleanText ?? ['true', 'false'];
      return v ? yes : no;
    }
    default:
      return String(v);
  }
}

/** `Event name 2026` → `event-name-2026`, for a download file name. */
export function fileSlug(s: string, fallback = 'export'): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || fallback
  );
}
