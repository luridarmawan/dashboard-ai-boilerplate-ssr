import { describe, expect, test } from 'bun:test';
import {
  civilOf,
  formatOffset,
  instantOf,
  isoIn,
  isValidTimeZone,
  offsetMinutes,
  rangesIn,
  weekdayOf,
} from '../src/lib/datetime.ts';

/**
 * Unit: the clock the `core.get_current_datetime` tool reads (internal tools, extension point 8).
 * The whole point of the tool is that a report boundary lands where the *reader's* calendar puts
 * it, so the cases that matter are the ones where UTC and the zone disagree: a Jakarta evening
 * that is still the previous UTC day, month and year rollovers, and a zone with DST — where an
 * offset read at "now" is the wrong offset to stamp on a boundary three weeks away.
 */
const JKT = 'Asia/Jakarta';
const NY = 'America/New_York';

describe('civil time in a zone', () => {
  test('reads the wall clock, not the server clock', () => {
    // 2026-09-14T20:30:00Z is already the 15th in Jakarta (+07:00).
    const at = new Date('2026-09-14T20:30:00Z');
    expect(civilOf(at, JKT)).toEqual({
      year: 2026,
      month: 9,
      day: 15,
      hour: 3,
      minute: 30,
      second: 0,
    });
    expect(civilOf(at, 'UTC').day).toBe(14);
  });

  test('offsets: fixed zone, DST zone on both sides of the change', () => {
    expect(offsetMinutes(new Date('2026-09-14T20:30:00Z'), JKT)).toBe(420);
    expect(offsetMinutes(new Date('2026-07-01T12:00:00Z'), NY)).toBe(-240); // EDT
    expect(offsetMinutes(new Date('2026-01-01T12:00:00Z'), NY)).toBe(-300); // EST
    expect(offsetMinutes(new Date('2026-07-01T12:00:00Z'), 'Asia/Kolkata')).toBe(330);
  });

  test('formatOffset renders half-hour and negative zones', () => {
    expect(formatOffset(420)).toBe('+07:00');
    expect(formatOffset(330)).toBe('+05:30');
    expect(formatOffset(-240)).toBe('-04:00');
    expect(formatOffset(-210)).toBe('-03:30');
    expect(formatOffset(0)).toBe('+00:00');
  });

  test('isoIn stamps the zone’s own offset', () => {
    expect(isoIn(new Date('2026-09-14T20:30:09Z'), JKT)).toBe('2026-09-15T03:30:09+07:00');
    expect(isoIn(new Date('2026-01-01T12:00:00Z'), NY)).toBe('2026-01-01T07:00:00-05:00');
  });

  test('instantOf is the inverse of civilOf, DST boundary included', () => {
    const at = new Date('2026-09-14T20:30:09Z');
    expect(instantOf(civilOf(at, JKT), JKT).toISOString()).toBe('2026-09-14T20:30:09.000Z');
    // Midnight on the day US DST starts (2026-03-08) is still EST: 05:00Z, not 04:00Z.
    const midnight = { year: 2026, month: 3, day: 8, hour: 0, minute: 0, second: 0 };
    expect(instantOf(midnight, NY).toISOString()).toBe('2026-03-08T05:00:00.000Z');
  });

  test('isValidTimeZone rejects what Intl does not know', () => {
    expect(isValidTimeZone(JKT)).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('x'.repeat(65))).toBe(false);
  });

  test('weekdayOf: 0 = Sunday', () => {
    expect(weekdayOf({ year: 2026, month: 9, day: 14, hour: 0, minute: 0, second: 0 })).toBe(1);
    expect(weekdayOf({ year: 2026, month: 9, day: 13, hour: 0, minute: 0, second: 0 })).toBe(0);
  });
});

describe('report ranges', () => {
  // Monday 2026-09-14, 03:30 Jakarta time (still Sunday evening in UTC).
  const at = new Date('2026-09-14T20:30:00Z');
  const r = rangesIn(at, JKT);

  test('every window is half-open and anchored to the zone’s midnight', () => {
    expect(r.today).toEqual({ from: '2026-09-15T00:00:00+07:00', to: '2026-09-16T00:00:00+07:00' });
    expect(r.yesterday.to).toBe(r.today.from);
    expect(r.last_7_days).toEqual({
      from: '2026-09-09T00:00:00+07:00',
      to: '2026-09-16T00:00:00+07:00',
    });
    expect(r.last_30_days.from).toBe('2026-08-17T00:00:00+07:00');
  });

  test('weeks start on Monday and months/years roll over', () => {
    // 2026-09-15 is a Tuesday in Jakarta → the week started Monday the 14th.
    expect(r.this_week).toEqual({
      from: '2026-09-14T00:00:00+07:00',
      to: '2026-09-21T00:00:00+07:00',
    });
    expect(r.last_week.to).toBe(r.this_week.from);
    expect(r.this_month).toEqual({
      from: '2026-09-01T00:00:00+07:00',
      to: '2026-10-01T00:00:00+07:00',
    });
    expect(r.last_month).toEqual({
      from: '2026-08-01T00:00:00+07:00',
      to: '2026-09-01T00:00:00+07:00',
    });
    expect(r.this_year).toEqual({
      from: '2026-01-01T00:00:00+07:00',
      to: '2027-01-01T00:00:00+07:00',
    });
  });

  test('a December reading rolls the month window into the next year', () => {
    const dec = rangesIn(new Date('2026-12-31T20:00:00Z'), JKT); // 2027-01-01 03:00 in Jakarta
    expect(dec.this_month.from).toBe('2027-01-01T00:00:00+07:00');
    expect(dec.last_month).toEqual({
      from: '2026-12-01T00:00:00+07:00',
      to: '2027-01-01T00:00:00+07:00',
    });
    expect(dec.this_year.from).toBe('2027-01-01T00:00:00+07:00');
  });

  test('in a DST zone each boundary carries the offset in force at that boundary', () => {
    // Reading taken in EST; the month it names ends after the spring-forward into EDT.
    const march = rangesIn(new Date('2026-03-05T12:00:00Z'), NY);
    expect(march.this_month.from).toBe('2026-03-01T00:00:00-05:00');
    expect(march.this_month.to).toBe('2026-04-01T00:00:00-04:00');
    // The day the clocks jump is 23 hours long, and the window still spans exactly that day.
    const jump = rangesIn(new Date('2026-03-08T18:00:00Z'), NY);
    expect(jump.today).toEqual({
      from: '2026-03-08T00:00:00-05:00',
      to: '2026-03-09T00:00:00-04:00',
    });
  });
});
