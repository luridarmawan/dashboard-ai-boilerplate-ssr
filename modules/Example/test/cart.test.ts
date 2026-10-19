import { describe, expect, test } from 'bun:test';
import { CART_MAX_QTY, changeCart, formatCart, parseCart } from '../cart.ts';

describe('demo cart cookie', () => {
  test('round-trips, merging duplicates and skipping junk', () => {
    expect(parseCart('kopi-gayo:2.v60:1.kopi-gayo:1.BAD:1.x:0.y:abc')).toEqual([
      { slug: 'kopi-gayo', qty: 3 },
      { slug: 'v60', qty: 1 },
    ]);
    expect(formatCart(parseCart('kopi-gayo:2.v60:1'))).toBe('kopi-gayo:2.v60:1');
    expect(parseCart(undefined)).toEqual([]);
  });

  test('changes add, subtract, drop at zero and cap the quantity', () => {
    let lines = changeCart([], 'kopi', 1);
    lines = changeCart(lines, 'kopi', 2);
    expect(lines).toEqual([{ slug: 'kopi', qty: 3 }]);
    expect(changeCart(lines, 'kopi', -3)).toEqual([]);
    expect(changeCart(lines, 'kopi', 500)[0]?.qty).toBe(CART_MAX_QTY);
    expect(changeCart(lines, '../evil', 1)).toEqual(lines);
  });
});
