import { describe, expect, test } from 'bun:test';
import { wrapOffset } from './auto-slide.ts';

/**
 * The seamless loop rests on one fold: once the row has scrolled past the first copy of the
 * items, the offset jumps back by exactly one copy, which shows the very same picture.
 */
describe('wrapOffset', () => {
  test('inside the first copy nothing moves', () => {
    expect(wrapOffset(0, 2380)).toBe(0);
    expect(wrapOffset(1020, 2380)).toBe(1020);
  });

  test('past the first copy it folds back by one period', () => {
    expect(wrapOffset(2380, 2380)).toBe(0);
    expect(wrapOffset(2720, 2380)).toBe(340);
  });

  test('sub-pixel layout just short of a period counts as the start', () => {
    expect(wrapOffset(2379.7, 2380)).toBe(0);
  });

  test('an unmeasured row (period 0) is left alone', () => {
    expect(wrapOffset(500, 0)).toBe(500);
  });
});
