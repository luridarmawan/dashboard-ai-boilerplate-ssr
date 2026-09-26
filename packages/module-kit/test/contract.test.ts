import { describe, expect, test } from 'bun:test';
import { defineConfig, defineWidgets, ModuleContractError } from '../src/contract.ts';

describe('defineWidgets (extension point 11)', () => {
  const base = {
    id: 'alpha.w',
    title: { id: 'W', en: 'W' },
    component: 'web/widgets/W.svelte',
  } as const;

  test('slot defaults to the dashboard and accepts `shell` (H-13)', () => {
    expect(defineWidgets('Alpha', [base])[0]?.slot).toBeUndefined();
    expect(defineWidgets('Alpha', [{ ...base, slot: 'shell' }])[0]?.slot).toBe('shell');
  });

  test('an unknown slot is refused at definition time', () => {
    expect(() =>
      defineWidgets('Alpha', [{ ...base, slot: 'sidebar' as unknown as 'shell' }]),
    ).toThrow(ModuleContractError);
  });
});

describe('defineConfig field groups (extension point 6)', () => {
  const title = { id: 'T', en: 'T' };
  const section = (groups: { key: string }[], group?: string) => ({
    section: 'alpha',
    title,
    groups: groups.map((g) => ({ ...g, title })),
    fields: [
      {
        key: 'alpha.x',
        type: 'string' as const,
        title,
        width: 'third' as const,
        ...(group ? { group } : {}),
      },
    ],
  });

  test('a field may point at a group its section declares', () => {
    const [s] = defineConfig('Alpha', [section([{ key: 'main' }], 'main')]);
    expect(s?.fields[0]?.group).toBe('main');
  });

  test('an undeclared group, a duplicate or a malformed group key is refused', () => {
    expect(() => defineConfig('Alpha', [section([], 'main')])).toThrow(ModuleContractError);
    expect(() => defineConfig('Alpha', [section([{ key: 'a' }, { key: 'a' }])])).toThrow(
      ModuleContractError,
    );
    expect(() => defineConfig('Alpha', [section([{ key: 'Bad Key' }])])).toThrow(
      ModuleContractError,
    );
  });
});
