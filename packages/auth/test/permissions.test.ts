import { describe, expect, test } from 'bun:test';
import {
  grantSatisfies,
  hasPermission,
  normalizeGrants,
  parsePermission,
} from '../src/permissions.ts';
import { allPermissionStrings, isRegistered, permissionRegistry } from '../src/registry.ts';

describe('permission strings (C-1, C-2)', () => {
  test('parse: the action is always the last segment; resources may be dotted', () => {
    expect(parsePermission('user.read')).toEqual({ resource: 'user', action: 'read' });
    expect(parsePermission('example.product.edit')).toEqual({
      resource: 'example.product',
      action: 'edit',
    });
    expect(parsePermission('*.*')).toEqual({ resource: '*', action: '*' });
    expect(parsePermission('user')).toBeNull();
    expect(parsePermission('User.Read')).toBeNull();
    expect(parsePermission('')).toBeNull();
  });

  test('exact, manage, and wildcard grants', () => {
    const req = { resource: 'user', action: 'edit' };
    expect(grantSatisfies('user.edit', req)).toBe(true);
    expect(grantSatisfies('user.read', req)).toBe(false);
    expect(grantSatisfies('user.manage', req)).toBe(true); // manage covers everything on the resource
    expect(grantSatisfies('user.*', req)).toBe(true);
    expect(grantSatisfies('*.edit', req)).toBe(true);
    expect(grantSatisfies('*.*', req)).toBe(true);
    expect(grantSatisfies('group.*', req)).toBe(false);
    expect(grantSatisfies('*.read', req)).toBe(false);
    expect(grantSatisfies('garbage', req)).toBe(false);
  });

  test('dotted module resources do not leak across namespaces', () => {
    expect(hasPermission(['example.*'], 'example.product.read')).toBe(false); // example.* ≠ example.product.*
    expect(hasPermission(['example.product.*'], 'example.product.read')).toBe(true);
    expect(hasPermission(['*.read'], 'example.product.read')).toBe(true);
  });

  test('hasPermission: a requirement must be concrete', () => {
    expect(hasPermission(['*.*'], 'user.*')).toBe(false);
    expect(hasPermission(['*.*'], '*.read')).toBe(false);
    expect(hasPermission([], 'user.read')).toBe(false);
    expect(hasPermission(['user.read', 'group.manage'], 'group.create')).toBe(true);
  });

  test('normalizeGrants trims, dedupes, sorts and drops invalid', () => {
    expect(normalizeGrants([' user.read', 'user.read', 'nope', 'group.*'])).toEqual([
      'group.*',
      'user.read',
    ]);
  });
});

describe('permission registry (C-4)', () => {
  test('core resources are present and module permissions are appended', () => {
    const reg = permissionRegistry();
    expect(reg.find((e) => e.resource === 'user')?.module).toBe('core');
    expect(reg.some((e) => e.resource === 'dummy.note' && e.module === 'Dummy')).toBe(true);
  });

  test('concrete strings are registered; wildcards and unknowns are not', () => {
    expect(isRegistered('user.read')).toBe(true);
    expect(isRegistered('dummy.note.manage')).toBe(true);
    expect(isRegistered('user.*')).toBe(false);
    expect(isRegistered('billing.invoice.read')).toBe(false);
    expect(allPermissionStrings()).toEqual([...allPermissionStrings()].sort());
  });
});
