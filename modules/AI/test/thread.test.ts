import { describe, expect, test } from 'bun:test';
import { activePath, siblingsAlong } from '../web/lib/thread.ts';

/** u1 → a1; regenerate → a2 (sibling of a1); on a2: u2 → a3; edit u1 → u1b → a4. */
const tree = [
  { id: 'u1', parentId: null },
  { id: 'a1', parentId: 'u1' },
  { id: 'a2', parentId: 'u1' },
  { id: 'u2', parentId: 'a2' },
  { id: 'a3', parentId: 'u2' },
  { id: 'u1b', parentId: null },
  { id: 'a4', parentId: 'u1b' },
];
const ids = (p: { id: string }[]) => p.map((m) => m.id);

describe('conversation tree (H-12)', () => {
  test('no leaf: the newest message ends the path', () => {
    expect(ids(activePath(tree))).toEqual(['u1b', 'a4']);
  });
  test('a leaf in the middle: ancestors, then the newest descendant at every step', () => {
    expect(ids(activePath(tree, 'a1'))).toEqual(['u1', 'a1']);
    expect(ids(activePath(tree, 'a2'))).toEqual(['u1', 'a2', 'u2', 'a3']);
    expect(ids(activePath(tree, 'u1'))).toEqual(['u1', 'a2', 'u2', 'a3']);
    expect(ids(activePath(tree, 'nope'))).toEqual(['u1b', 'a4']);
  });
  test('siblings: position and neighbours, roots included', () => {
    const path = activePath(tree, 'a1');
    const s = siblingsAlong(tree, path);
    expect(s.u1).toEqual({ index: 1, count: 2, prev: null, next: 'u1b' });
    expect(s.a1).toEqual({ index: 1, count: 2, prev: null, next: 'a2' });
    const s2 = siblingsAlong(tree, activePath(tree, 'a2'));
    expect(s2.a2).toEqual({ index: 2, count: 2, prev: 'a1', next: null });
    expect(s2.u2).toEqual({ index: 1, count: 1, prev: null, next: null });
  });
  test('legacy linear rows (no parents) read as one linear path, newest last', () => {
    const flat = [
      { id: 'm1', parentId: null },
      { id: 'm2', parentId: null },
      { id: 'm3', parentId: null },
    ];
    // Before the server backfills parents, every row is a root: the newest is shown alone…
    expect(ids(activePath(flat))).toEqual(['m3']);
    // …and after the backfill (what GET /conversations/:id does) the chain is linear.
    const linked = flat.map((m, i) => ({ ...m, parentId: i ? (flat[i - 1]?.id ?? null) : null }));
    expect(ids(activePath(linked))).toEqual(['m1', 'm2', 'm3']);
  });
  test('a dangling parent counts as a root; cycles cannot hang the walk', () => {
    expect(ids(activePath([{ id: 'x', parentId: 'gone' }]))).toEqual(['x']);
    const cyc = [
      { id: 'p', parentId: 'q' },
      { id: 'q', parentId: 'p' },
    ];
    expect(activePath(cyc, 'p').length).toBe(2);
  });
});
