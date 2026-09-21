import { describe, expect, it } from 'bun:test';
import { formatDateTime } from './format';

describe('formatDateTime', () => {
  it('renders yyyy-mm-dd HH:mm:ss with a 24-hour clock', () => {
    // Built from local components so the expectation holds in any TZ the test runs in.
    const d = new Date(2026, 8, 21, 14, 5, 9);
    expect(formatDateTime(d)).toBe('2026-09-21 14:05:09');
    expect(formatDateTime(d.toISOString())).toBe('2026-09-21 14:05:09');
  });
  it('zero-pads every field', () => {
    expect(formatDateTime(new Date(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02 03:04:05');
  });
  it('falls back to a dash for empty or invalid input', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
    expect(formatDateTime('')).toBe('—');
    expect(formatDateTime('not a date')).toBe('—');
  });
});
