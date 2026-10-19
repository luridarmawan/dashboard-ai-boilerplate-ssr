/**
 * Header links of the public shell: the module public routes that asked for one (`nav` in
 * `public.ts`, extension point 13). A link of a module disabled for the tenant is dropped, like
 * the page it points to (G-8). Pure, so it is tested without a request.
 */
export interface PublicNavRoute {
  readonly path: string;
  readonly ns: string;
  readonly nav: {
    readonly label: { readonly id: string; readonly en: string };
    readonly order: number;
  } | null;
}

export interface PublicNavLink {
  readonly href: string;
  readonly label: string;
  /** The visitor is on this page or below it (`/event` for `/event/liga-2026`). */
  readonly current: boolean;
}

export function publicNavLinks(
  routes: readonly PublicNavRoute[],
  enabled: ReadonlySet<string>,
  locale: string,
  path: string,
): PublicNavLink[] {
  return routes
    .filter((r) => r.nav && enabled.has(r.ns))
    .sort((a, b) => (a.nav?.order ?? 0) - (b.nav?.order ?? 0) || a.path.localeCompare(b.path))
    .map((r) => ({
      href: r.path,
      label: locale === 'en' ? (r.nav?.label.en ?? '') : (r.nav?.label.id ?? ''),
      current: path === r.path || path.startsWith(`${r.path}/`),
    }));
}
