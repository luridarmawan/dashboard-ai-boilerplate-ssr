/**
 * Timezone-aware clock helpers for the core `core.get_current_datetime` tool.
 *
 * Pure and dependency-free: everything comes from `Intl`, which Bun ships with full ICU. The
 * point is that "hari ini" / "bulan lalu" must be anchored to the calendar the *reader* lives
 * in, not to the server's — rows are stored in UTC (`packages/db` pins the MySQL session to
 * `Z`), so a report asked for "bulan ini" in Asia/Jakarta starts seven hours before the UTC
 * month does. Every boundary here is therefore computed in the zone and rendered back as an
 * ISO-8601 string *with its offset*, which is exactly the shape a query filter wants.
 *
 * Ranges are half-open — `from` inclusive, `to` exclusive — so adjacent ranges never overlap
 * and "sampai akhir hari" needs no 23:59:59 fudge.
 */

/** A wall-clock reading: what a clock in the zone shows, with no instant attached yet. */
export interface Civil {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/** Half-open `[from, to)`, both ISO-8601 with the zone's offset. */
export interface DateRange {
  readonly from: string;
  readonly to: string;
}

/** The report windows `rangesIn` names. Fixed set: the model is told these exact keys. */
export interface ReportRanges {
  readonly today: DateRange;
  readonly yesterday: DateRange;
  readonly this_week: DateRange;
  readonly last_week: DateRange;
  readonly this_month: DateRange;
  readonly last_month: DateRange;
  readonly this_year: DateRange;
  readonly last_7_days: DateRange;
  readonly last_30_days: DateRange;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function civilFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    // en-US + h23 so the parts are plain numbers: this formatter is read by code, never shown.
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Is this an IANA zone this runtime knows? Anything typed by a user passes through here first. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The zone this process runs in — `TZ` in the environment, which is what `Intl` resolves from,
 * falling back to UTC on a runtime that cannot say.
 */
export function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** What a clock in `timeZone` reads at this instant. */
export function civilOf(at: Date, timeZone: string): Civil {
  const p: Record<string, string> = {};
  for (const part of civilFormatter(timeZone).formatToParts(at)) p[part.type] = part.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

/** Minutes the zone is ahead of UTC at this instant (DST included). Asia/Jakarta → 420. */
export function offsetMinutes(at: Date, timeZone: string): number {
  const c = civilOf(at, timeZone);
  const wall = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
  return Math.round((wall - (at.getTime() - at.getMilliseconds())) / 60_000);
}

/** 420 → `+07:00`, -210 → `-03:30`. */
export function formatOffset(minutes: number): string {
  const abs = Math.abs(minutes);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${minutes < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/**
 * The instant a wall-clock reading names in `timeZone`. Two passes: guess with the offset in
 * force at the naive UTC reading, then correct with the offset actually in force at that
 * instant — the standard fix for readings that sit on a DST jump.
 */
export function instantOf(c: Civil, timeZone: string): Date {
  const wall = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
  const first = wall - offsetMinutes(new Date(wall), timeZone) * 60_000;
  return new Date(wall - offsetMinutes(new Date(first), timeZone) * 60_000);
}

/** `2026-09-14T17:05:09+07:00` — the instant as the zone writes it. */
export function isoIn(at: Date, timeZone: string): string {
  const c = civilOf(at, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(c.year).padStart(4, '0')}-${pad(c.month)}-${pad(c.day)}T${pad(c.hour)}:${pad(
    c.minute,
  )}:${pad(c.second)}${formatOffset(offsetMinutes(at, timeZone))}`;
}

/** Day of week of a civil date, 0 = Sunday (the calendar is the same in any zone). */
export function weekdayOf(c: Civil): number {
  return new Date(Date.UTC(c.year, c.month - 1, c.day)).getUTCDay();
}

/** Midnight of `c` shifted by whole days — month and year roll over for us. */
function midnight(c: Civil, shiftDays = 0): Civil {
  const d = new Date(Date.UTC(c.year, c.month - 1, c.day + shiftDays));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
  };
}

/** Midnight on the first of a month, `shiftMonths` away from `c`'s month. */
function firstOfMonth(c: Civil, shiftMonths = 0): Civil {
  const d = new Date(Date.UTC(c.year, c.month - 1 + shiftMonths, 1));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
  };
}

/**
 * Ready-made report windows around `at`, in `timeZone`. Weeks start on **Monday** (ISO-8601);
 * `last_7_days` / `last_30_days` are rolling *calendar* days ending with today, so they line up
 * with the other windows instead of cutting off mid-day.
 */
export function rangesIn(at: Date, timeZone: string): ReportRanges {
  const now = civilOf(at, timeZone);
  const iso = (c: Civil) => isoIn(instantOf(c, timeZone), timeZone);
  const span = (from: Civil, to: Civil): DateRange => ({ from: iso(from), to: iso(to) });
  const today = midnight(now);
  const tomorrow = midnight(now, 1);
  // Monday = 0 … Sunday = 6, so the arithmetic reads the way the calendar does.
  const sinceMonday = (weekdayOf(now) + 6) % 7;
  const thisWeek = midnight(now, -sinceMonday);
  return {
    today: span(today, tomorrow),
    yesterday: span(midnight(now, -1), today),
    this_week: span(thisWeek, midnight(thisWeek, 7)),
    last_week: span(midnight(thisWeek, -7), thisWeek),
    this_month: span(firstOfMonth(now), firstOfMonth(now, 1)),
    last_month: span(firstOfMonth(now, -1), firstOfMonth(now)),
    this_year: span(
      { year: now.year, month: 1, day: 1, hour: 0, minute: 0, second: 0 },
      { year: now.year + 1, month: 1, day: 1, hour: 0, minute: 0, second: 0 },
    ),
    last_7_days: span(midnight(now, -6), tomorrow),
    last_30_days: span(midnight(now, -29), tomorrow),
  };
}
