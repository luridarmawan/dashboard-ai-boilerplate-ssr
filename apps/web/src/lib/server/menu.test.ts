import { describe, expect, test } from 'bun:test';
import { buildMenu } from './menu.ts';
import type { Session } from './session.ts';

/** Sidebar shape (F-3) against the real generated registry: top level, then groups, Monitoring last. */
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

  test('top-level links first, then groups, Monitoring last', () => {
    const kinds = menu.map((i) => i.kind);
    expect(kinds.indexOf('group')).toBeGreaterThan(0);
    expect(kinds.slice(kinds.indexOf('group')).every((k) => k === 'group')).toBe(true);
    expect(labels(menu).slice(0, 2)).toEqual(['Dashboard', 'AI assistant']);
    expect(menu.at(-1)?.id).toBe('group.monitoring');
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
    expect(labels(group(menu, 'monitoring')?.children ?? [])).toEqual(['Job queue', 'AI log']);
  });

  test('module entries without a group land in the module’s own group, titled from module.json', () => {
    expect(labels(group(menu, 'dummy')?.children ?? [])).toEqual(['Notes']);
    expect(group(menu, 'dummy')?.label).toBe('Dummy');
    expect(labels(group(menu, 'example')?.children ?? [])).toEqual(['Products', 'Inquiries']);
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
});
