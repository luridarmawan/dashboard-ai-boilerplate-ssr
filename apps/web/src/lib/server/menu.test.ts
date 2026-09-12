import { describe, expect, test } from 'bun:test';
import { buildMenu } from './menu.ts';
import type { Session } from './session.ts';

/** Sidebar shape (F-3) against the real generated registry: top level, then groups, Documentation last. */
const admin = {
  user: { id: 'u', isSuperadmin: true },
  clientId: 'c',
  tenants: [],
  permissions: ['*.*'],
  impersonator: null,
  can: () => true,
} as unknown as Session;
const nobody = { ...admin, can: () => false } as unknown as Session;

const labels = (items: ReturnType<typeof buildMenu>) => items.map((i) => i.label);
const group = (items: ReturnType<typeof buildMenu>, id: string) =>
  items.find((i) => i.kind === 'group' && i.id === `group.${id}`);

describe('buildMenu (F-3 groups)', () => {
  const menu = buildMenu(admin, '/m/ai/providers', 'en');

  test('top-level links first, then groups, Documentation last', () => {
    const kinds = menu.map((i) => i.kind);
    expect(kinds.indexOf('group')).toBeGreaterThan(0);
    expect(kinds.slice(kinds.indexOf('group')).every((k) => k === 'group')).toBe(true);
    expect(labels(menu).slice(0, 2)).toEqual(['Dashboard', 'AI assistant']);
    expect(menu.at(-1)?.id).toBe('group.documentation');
  });

  test('core groups hold the core pages; AI joins Integration and Monitoring', () => {
    expect(labels(group(menu, 'settings')?.children ?? [])).toEqual([
      'Users',
      'Groups & permissions',
      'Tenants',
      'Custom themes',
      'Settings',
      'Modules',
    ]);
    expect(labels(group(menu, 'integration')?.children ?? [])).toEqual([
      'Outgoing webhooks',
      'MCP servers',
    ]);
    expect(labels(group(menu, 'monitoring')?.children ?? [])).toEqual([
      'Job queue',
      'Email outbox',
      'AI log',
    ]);
  });

  test('Documentation is the last group; the API reference opens outside the router', () => {
    const docs = group(menu, 'documentation');
    expect(labels(docs?.children ?? [])).toEqual(['Permission guide', 'API Docs']);
    // `/docs` is served by the API on this origin: a new tab, never a client-side route.
    expect(docs?.children.find((c) => c.id === 'core.apidocs')?.external).toBe(true);
    expect(docs?.children.find((c) => c.id === 'core.permissions')?.external).toBeUndefined();
    // Reference material sits below Monitoring, at the very bottom of the menu.
    const ids = menu.filter((i) => i.kind === 'group').map((i) => i.id);
    expect(ids.at(-1)).toBe('group.documentation');
    expect(ids.at(-2)).toBe('group.monitoring');
  });

  test('a reader without the permissions never gets the group at all', () => {
    const reader = {
      ...admin,
      permissions: ['user.read'],
      can: (p: string) => p === 'user.read',
    } as unknown as Session;
    expect(group(buildMenu(reader, '/users', 'en'), 'documentation')).toBeUndefined();
  });

  test('module entries without a group land in the module’s own group, titled from module.json', () => {
    expect(labels(group(menu, 'dummy')?.children ?? [])).toEqual(['Notes']);
    expect(group(menu, 'dummy')?.label).toBe('Dummy');
    // `/examples` is a CORE page that asks for the Example module's group (it demonstrates it).
    expect(labels(group(menu, 'example')?.children ?? [])).toEqual([
      'Products',
      'Inquiries',
      'Page Examples',
    ]);
    expect(group(menu, 'ai')?.label).toBe('AI Platform');
    expect(labels(group(menu, 'ai')?.children ?? [])).toEqual(['AI providers', 'AI analytics']);
    // nothing module-owned leaks to the top level
    const top = menu.filter((i) => i.kind === 'link').map((i) => i.id);
    expect(top).toEqual(['core.dashboard', 'ai.chat']);
  });

  test('the group holding the current page is active; others are not', () => {
    expect(group(menu, 'ai')?.active).toBe(true);
    expect(group(menu, 'settings')?.active).toBe(false);
    expect(group(menu, 'ai')?.children.find((c) => c.href === '/m/ai/providers')?.active).toBe(
      true,
    );
  });

  test('a group whose entries are all hidden is not built', () => {
    const bare = buildMenu(nobody, '/dashboard', 'en');
    expect(labels(bare)).toEqual(['Dashboard']);
  });

  test('a disabled module contributes neither entries nor a group (G-8)', () => {
    const noDummy = buildMenu(admin, '/dashboard', 'en', new Set(['ai', 'example']));
    expect(group(noDummy, 'dummy')).toBeUndefined();
    expect(group(noDummy, 'example')).toBeDefined();
  });

  test('a core entry placed in a module group goes with the group (G-8)', () => {
    const noExample = buildMenu(admin, '/dashboard', 'en', new Set(['ai', 'dummy']));
    expect(group(noExample, 'example')).toBeUndefined();
    // and it does not fall back to the top level either
    expect(noExample.some((i) => i.id === 'core.examples')).toBe(false);
  });
});
