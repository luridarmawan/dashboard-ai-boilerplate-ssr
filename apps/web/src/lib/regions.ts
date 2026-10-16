/**
 * Region code rules shared by the region pickers. Pure functions, no I/O: safe on the server and
 * in the browser. Codes are dotted paths — `11.01.01` lies under `11.01` and under `11`.
 */
export function isRegionUnder(child: string, parent: string): boolean {
  return child.startsWith(`${parent}.`);
}

/**
 * Keeps a posted province → city → district → village chain consistent: a level that no longer
 * lies under the level above it (the parent changed, with or without JavaScript) is cleared,
 * and so is everything below it.
 */
export function regionChain(ids: readonly (string | null | undefined)[]): (string | null)[] {
  const out: (string | null)[] = [];
  let parent: string | null = null;
  ids.forEach((raw, i) => {
    const id = raw || null;
    const ok = id !== null && (i === 0 || (parent !== null && isRegionUnder(id, parent)));
    out.push(ok ? id : null);
    parent = ok ? id : null;
  });
  return out;
}
