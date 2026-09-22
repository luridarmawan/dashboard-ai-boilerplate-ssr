/**
 * Fixed-shape timestamps for admin tables: `yyyy-mm-dd HH:mm:ss`, 24-hour clock, no locale
 * variance. A list is scanned column by column, so every cell must line up; `toLocaleString`
 * would give `21/09/2026 14.05.09` in one locale and `9/21/2026, 2:05:09 PM` in another.
 * Rendered in the process's local time zone (the server's during SSR).
 */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (value == null || value === '') return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
