/**
 * Conversation tree helpers (H-12). Messages form a tree through `parentId`: a user message hangs
 * under the previous reply (null at the root), a reply under its user message. "Regenerate" adds a
 * second reply under the same user message; "edit" adds a second user message under the same
 * parent. The page shows ONE path through the tree — the active path — and lets the reader step
 * sideways between siblings. Pure functions: the loader and the tests share them.
 */
export interface ThreadNode {
  id: string;
  parentId: string | null;
}

export interface SiblingInfo {
  /** 1-based position among the siblings, in creation order. */
  index: number;
  count: number;
  prev: string | null;
  next: string | null;
}

/** Children of every node (and of the root, keyed by null), in the order given (creation order). */
function childrenOf<T extends ThreadNode>(all: readonly T[]): Map<string | null, T[]> {
  const byId = new Set(all.map((m) => m.id));
  const map = new Map<string | null, T[]>();
  for (const m of all) {
    // A dangling parent (deleted, or a pre-threading row) counts as a root.
    const key = m.parentId && byId.has(m.parentId) ? m.parentId : null;
    const list = map.get(key);
    if (list) list.push(m);
    else map.set(key, [m]);
  }
  return map;
}

/**
 * The path through the tree that ends at `leafId`'s deepest newest descendant: its ancestors, the
 * node itself, then the newest child at every step down. Without `leafId` (or an unknown one) the
 * newest message is the leaf — what a reader expects to see when opening a conversation.
 */
export function activePath<T extends ThreadNode>(all: readonly T[], leafId?: string | null): T[] {
  if (!all.length) return [];
  const byId = new Map(all.map((m) => [m.id, m] as const));
  const children = childrenOf(all);
  const start = (leafId ? byId.get(leafId) : undefined) ?? (all[all.length - 1] as T);
  const path: T[] = [];
  const seen = new Set<string>();
  let cur: T | undefined = start;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  let tail: T = start;
  for (;;) {
    const kids = children.get(tail.id);
    const next = kids?.[kids.length - 1];
    if (!next || seen.has(next.id)) break;
    seen.add(next.id);
    path.push(next);
    tail = next;
  }
  return path;
}

/** For each message on the path: where it stands among its siblings, and how to step sideways. */
export function siblingsAlong<T extends ThreadNode>(
  all: readonly T[],
  path: readonly T[],
): Record<string, SiblingInfo> {
  const byId = new Set(all.map((m) => m.id));
  const children = childrenOf(all);
  const out: Record<string, SiblingInfo> = {};
  for (const m of path) {
    const key = m.parentId && byId.has(m.parentId) ? m.parentId : null;
    const list = children.get(key) ?? [m];
    const i = list.findIndex((x) => x.id === m.id);
    out[m.id] = {
      index: i + 1,
      count: list.length,
      prev: list[i - 1]?.id ?? null,
      next: list[i + 1]?.id ?? null,
    };
  }
  return out;
}
