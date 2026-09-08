import { describe, expect, test } from 'bun:test';
import { directionOf } from '../src/index.ts';

describe('directionOf (K-9)', () => {
  test('right-to-left languages, by language subtag', () => {
    for (const l of ['ar', 'ar-EG', 'he', 'fa_IR', 'ur', 'AR']) expect(directionOf(l)).toBe('rtl');
  });
  test('everything else is left-to-right, including nothing at all', () => {
    for (const l of ['id', 'en', 'en-US', 'ja', '', null, undefined])
      expect(directionOf(l)).toBe('ltr');
  });
});
