import { describe, expect, test } from 'bun:test';
import { matchTrap, normalizeTrapPath, TRAP_RULES, titleFromSlug } from '../trap.ts';

/**
 * Unit (no DB, no app): the module's URL trap table (F-11). What matters is that a developer can
 * predict which rule answers which URL — the order, the forgiveness (trailing slash, case,
 * encoding) and the refusal of everything else, because "everything else" is what the
 * built-in 404 must keep answering.
 */
describe('Example trap rules (F-11)', () => {
  test('/category-<slug> is the category demo', () => {
    const r = matchTrap('/category-food');
    expect(r?.rule.id).toBe('category-prefix');
    expect(r?.hit).toEqual({ kind: 'category-demo', slug: 'food', name: 'Food' });
  });

  test('/<category>/<item> is the item demo', () => {
    const r = matchTrap('/food/nasi-goreng');
    expect(r?.rule.id).toBe('category-item');
    expect(r?.hit).toEqual({
      kind: 'item-demo',
      category: 'food',
      slug: 'nasi-goreng',
      name: 'Nasi Goreng',
    });
  });

  test('the old site was forgiving, so are we: trailing slash, case, encoding, query', () => {
    expect(matchTrap('/category-food/')?.hit.kind).toBe('category-demo');
    expect(matchTrap('/Category-Food')?.hit.kind).toBe('category-demo');
    expect(matchTrap('/food/nasi%2Dgoreng')?.hit.kind).toBe('item-demo');
    expect(matchTrap('/food/nasi-goreng?utm=x')?.hit.kind).toBe('item-demo');
  });

  test("everything else is nobody's URL and falls through to the next resolver / the 404", () => {
    for (const p of [
      '/',
      '/category-',
      '/category-food/extra/deeper',
      '/food',
      '/food/nasi-goreng/pedas',
      '/wp-admin.php',
      '/a b',
      '/%E0%A4%A',
    ])
      expect(matchTrap(p), p).toBeNull();
  });

  test('rules are tried in order and a rule may decline', () => {
    const r = matchTrap('/food/nasi-goreng', [
      { id: 'decline', pattern: /^\/(.+)$/, resolve: () => null },
      ...TRAP_RULES,
    ]);
    expect(r?.rule.id).toBe('category-item');
  });

  test('helpers', () => {
    expect(normalizeTrapPath('/Food/Nasi-Goreng///')).toBe('/food/nasi-goreng');
    expect(normalizeTrapPath('/')).toBe('/');
    expect(normalizeTrapPath('/%E0%A4%A')).toBeNull();
    expect(titleFromSlug('kotak-penyimpanan-serbaguna')).toBe('Kotak Penyimpanan Serbaguna');
  });
});
