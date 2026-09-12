import { describe, expect, test } from 'bun:test';
// The authority (C-1, C-2). Imported by FILE, not by package: `@core/auth`'s index pulls in the
// database client, which has no business in the web app — this module is pure string matching.
import { hasPermission as authoritative } from '../../../../packages/auth/src/permissions.ts';
import { canWith, hasPermission } from './permissions.ts';

/**
 * `$lib/permissions` is a deliberate copy of the API's rule so layouts and pages can use it in the
 * browser (C-6b). A copy is only safe while it agrees, and the permission guide page (C-8) now
 * teaches admins with it — so this pins the two implementations to each other.
 */
const GRANTS = [
  'user.edit',
  'user.read',
  'user.manage',
  'user.*',
  '*.edit',
  '*.*',
  'example.product.edit',
  'example.product.manage',
  'group.read',
  'User.Edit', // wrong case
  'user', // no action
  '', // empty
  '.edit',
  'user..edit',
];
const REQUIRED = [
  'user.edit',
  'user.read',
  'user.impersonate',
  'group.read',
  'example.product.edit',
  'example.product.read',
  'user.*', // not a legal requirement
  '*.*',
  'user',
  '',
];

describe('permission matching mirrors @core/auth', () => {
  test('every grant × requirement pair gives the same verdict', () => {
    for (const g of GRANTS) {
      for (const r of REQUIRED) {
        expect(`${g} → ${r}: ${hasPermission([g], r)}`).toBe(
          `${g} → ${r}: ${authoritative([g], r)}`,
        );
      }
    }
  });

  test('a set of grants behaves like the union of its members', () => {
    const set = ['group.read', 'example.product.edit'];
    for (const r of REQUIRED) {
      expect(hasPermission(set, r)).toBe(authoritative(set, r));
      expect(hasPermission(set, r)).toBe(set.some((g) => hasPermission([g], r)));
    }
  });
});

describe('canWith (C-5)', () => {
  test('a superadmin needs no grant at all; everyone else goes through the rule', () => {
    expect(canWith({ isSuperadmin: true }, [])('user.edit')).toBe(true);
    expect(canWith({ isSuperadmin: false }, [])('user.edit')).toBe(false);
    expect(canWith({ isSuperadmin: false }, ['user.*'])('user.edit')).toBe(true);
  });
});
