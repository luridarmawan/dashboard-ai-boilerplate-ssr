import { describe, expect, test } from 'bun:test';
import { defineWidgets, ModuleContractError } from '../src/contract.ts';

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
