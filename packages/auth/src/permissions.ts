/**
 * Permission strings and matching (PRD C-1, C-2).
 *
 *   <resource>.<action>       e.g. user.read, example.product.edit
 *   manage                    implies every action on that resource
 *   wildcards                 *.*  user.*  *.read
 *
 * A resource may itself be dotted (`example.product`); the ACTION is always the last segment.
 * Matching is pure and total — it never throws on odd input, it just does not match.
 */

export const MANAGE = 'manage';

export interface ParsedPermission {
  readonly resource: string;
  readonly action: string;
}

const PERMISSION_RE = /^([a-z*][a-z0-9_*]*(?:\.[a-z*][a-z0-9_*]*)*)\.([a-z*][a-z0-9_*]*)$/;

/** Split `resource.action`; null when the shape is invalid. */
export function parsePermission(p: string): ParsedPermission | null {
  const m = PERMISSION_RE.exec(p);
  return m?.[1] && m[2] ? { resource: m[1], action: m[2] } : null;
}

export function isValidPermission(p: string): boolean {
  return parsePermission(p) !== null;
}

/** Does one GRANTED string (possibly with wildcards / manage) satisfy one REQUIRED concrete permission? */
export function grantSatisfies(granted: string, required: ParsedPermission): boolean {
  const g = parsePermission(granted);
  if (!g) return false;
  const resourceOk = g.resource === '*' || g.resource === required.resource;
  if (!resourceOk) return false;
  return g.action === '*' || g.action === MANAGE || g.action === required.action;
}

/**
 * `hasPermission(granted, 'user.edit')` — the check the API guard and the UI use.
 * Superadmin is decided by the caller (C-5); this function knows nothing about users.
 */
export function hasPermission(granted: Iterable<string>, required: string): boolean {
  const req = parsePermission(required);
  if (!req) return false;
  if (req.resource === '*' || req.action === '*') return false; // a requirement is always concrete
  for (const g of granted) if (grantSatisfies(g, req)) return true;
  return false;
}

/** Normalise a grant list: trim, dedupe, drop invalid entries (reported separately by callers). */
export function normalizeGrants(list: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const raw of list) {
    const p = raw.trim();
    if (isValidPermission(p)) out.add(p);
  }
  return [...out].sort();
}
