import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANONYMOUS_NAMESPACES, messagesFor } from '@core/i18n';
import { Glob } from 'bun';
import { modulePublicRoutes } from '../../generated/public-routes.ts';

/**
 * The anonymous i18n payload (PRD §9, K-4). The root layout sends only ANONYMOUS_NAMESPACES (plus
 * the namespaces of modules with public routes) to a visitor who is not signed in, so the landing
 * page does not carry the dashboard's catalogue. This test fails when a page an anonymous visitor
 * can reach — a public page, an auth page, an error page, or any shared component/layout they
 * render — starts using a key outside that set, which would render as the raw key.
 */
const root = join(import.meta.dir, '../../../../..');
const web = join(root, 'apps/web/src');

/** Everything an anonymous visitor can render. */
const PATTERNS: readonly [string, string][] = [
  [web, 'routes/(public)/**/*.svelte'],
  [web, 'routes/auth/**/*.svelte'],
  [web, 'routes/+error.svelte'],
  [web, 'routes/+layout.svelte'],
  [web, 'lib/components/**/*.svelte'],
  [web, 'lib/layouts/**/*.svelte'],
  [root, 'modules/*/web/public/**/*.svelte'],
];

function usedKeys(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const [base, pattern] of PATTERNS) {
    for (const rel of new Glob(pattern).scanSync({ cwd: base })) {
      const file = join(base, rel);
      for (const m of readFileSync(file, 'utf8').matchAll(
        /\bt\('([a-z][a-z0-9_]*\.[a-z0-9_.]+)'/g,
      )) {
        const key = m[1] as string;
        found.set(key, [...(found.get(key) ?? []), rel]);
      }
    }
  }
  return found;
}

const allowed = new Set([...ANONYMOUS_NAMESPACES, ...modulePublicRoutes.map((r) => r.ns)]);
const catalogue = messagesFor('id');
const anonymous = messagesFor('id', [...allowed]);

describe('anonymous i18n payload', () => {
  test('every key an anonymous visitor can render is in the anonymous payload', () => {
    const missing = [...usedKeys()]
      .filter(([key]) => !(key in anonymous))
      .map(([key, files]) => `${key} (${[...new Set(files)].join(', ')})`);
    expect(missing).toEqual([]);
  });

  test('the keys scanned are real: none is missing from the catalogue', () => {
    const unknown = [...usedKeys().keys()].filter((k) => !(k in catalogue));
    expect(unknown).toEqual([]);
  });

  test('the payload is a real subset — the dashboard-only namespaces stay out', () => {
    expect(Object.keys(anonymous).length).toBeLessThan(Object.keys(catalogue).length);
    for (const ns of ['users', 'groups', 'settings', 'modules', 'themes', 'queue', 'webhooks']) {
      expect(ANONYMOUS_NAMESPACES).not.toContain(ns);
    }
  });

  test('no dead namespace in the list', () => {
    const known = new Set(Object.keys(catalogue).map((k) => k.split('.')[0]));
    expect(ANONYMOUS_NAMESPACES.filter((ns) => !known.has(ns))).toEqual([]);
  });
});
