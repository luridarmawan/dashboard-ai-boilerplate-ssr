import { describe, expect, test } from 'bun:test';
import { regionChain } from './regions';

describe('regionChain', () => {
  test('a consistent chain is kept', () => {
    expect(regionChain(['11', '11.01', '11.01.01', '11.01.01.2001'])).toEqual([
      '11',
      '11.01',
      '11.01.01',
      '11.01.01.2001',
    ]);
  });
  test('a changed parent clears every level below it', () => {
    expect(regionChain(['12', '11.01', '11.01.01', '11.01.01.2001'])).toEqual([
      '12',
      null,
      null,
      null,
    ]);
    expect(regionChain(['11', '11.01', '11.02.01', '11.02.01.2001'])).toEqual([
      '11',
      '11.01',
      null,
      null,
    ]);
  });
  test('empty values are null, and nothing hangs under an empty level', () => {
    expect(regionChain(['', '11.01', undefined, null])).toEqual([null, null, null, null]);
  });
});
