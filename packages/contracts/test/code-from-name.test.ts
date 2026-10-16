import { describe, expect, test } from 'bun:test';
import { codeFromName } from '../src/code.ts';

const VALID = /^[a-z][a-z0-9_-]*$/;

describe('codeFromName', () => {
  test('lower-cases and turns spaces and punctuation into one underscore', () => {
    expect(codeFromName('PT. Maju Jaya')).toBe('pt_maju_jaya');
    expect(codeFromName('Acme Corp')).toBe('acme_corp');
    expect(codeFromName('  Café 24/7 ')).toBe('caf_24_7');
  });
  test('never starts with a digit or underscore, and never ends with one', () => {
    expect(codeFromName('2nd Floor')).toBe('t_2nd_floor');
    expect(codeFromName('_hidden_')).toBe('hidden');
    expect(codeFromName('(Branch)')).toBe('branch');
  });
  test('cuts to the maximum without leaving a dangling underscore', () => {
    const long = codeFromName('a very long tenant name that goes on and on', 32);
    expect(long.length).toBeLessThanOrEqual(32);
    expect(long).toBe('a_very_long_tenant_name_that_goe');
    expect(codeFromName('abcdefgh ijk', 9)).toBe('abcdefgh');
  });
  test('gives nothing usable back as an empty string', () => {
    expect(codeFromName('')).toBe('');
    expect(codeFromName('   ')).toBe('');
    expect(codeFromName('***')).toBe('');
  });
  test('every non-empty result is a valid code', () => {
    for (const s of ['Hello World', '42', 'ünïcødé', 'a-b', 'x']) {
      const c = codeFromName(s);
      if (c) expect(c).toMatch(VALID);
    }
  });
});
