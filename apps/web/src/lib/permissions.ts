/**
 * Permission matching for the UI (C-6b — cosmetic; the API decides). Same semantics as
 * `@core/auth`: `manage` and wildcards (`*.*`, `user.*`, `*.read`) satisfy a concrete permission.
 * Browser-safe: no server imports, so layouts and pages may use it.
 */
export function hasPermission(granted: Iterable<string>, required: string): boolean {
  const dot = required.lastIndexOf('.');
  if (dot < 1) return false;
  const res = required.slice(0, dot);
  const act = required.slice(dot + 1);
  // A requirement is always concrete: `user.*` is something you GRANT, never something a page
  // asks for. @core/auth refuses it too, and permissions.test.ts pins the two together.
  if (res === '*' || act === '*') return false;
  for (const g of granted) {
    const d = g.lastIndexOf('.');
    if (d < 1) continue;
    const gr = g.slice(0, d);
    const ga = g.slice(d + 1);
    if ((gr === '*' || gr === res) && (ga === '*' || ga === 'manage' || ga === act)) return true;
  }
  return false;
}

/** `can` for a rendered page: superadmin sees everything (C-5). */
export function canWith(user: { isSuperadmin: boolean }, permissions: readonly string[]) {
  return (p: string) => user.isSuperadmin || hasPermission(permissions, p);
}
