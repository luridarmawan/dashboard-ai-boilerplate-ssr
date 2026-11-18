import { describe, expect, test } from 'bun:test';
import { storageFolder } from '../src/files.ts';

describe('storageFolder', () => {
  test('keeps lower-case segments of letters, digits and dashes', () => {
    expect(storageFolder('event')).toBe('event');
    expect(storageFolder('member/photo')).toBe('member/photo');
    expect(storageFolder('Member/Family-Card')).toBe('member/family-card');
  });

  test('never leaves the tenant: no dot segments, no leading or doubled slashes', () => {
    expect(storageFolder('../other-tenant/x')).toBe('other-tenant/x');
    expect(storageFolder('/member//photo/')).toBe('member/photo');
    expect(storageFolder('a\\b c.d')).toBe('abcd');
  });

  test('no folder is an empty string', () => {
    expect(storageFolder(undefined)).toBe('');
    expect(storageFolder('')).toBe('');
    expect(storageFolder('..')).toBe('');
  });
});
