/**
 * Header links of the public shell: the module public routes that asked for one (`nav` in
 * `public.ts`, extension point 13). A link of a module disabled for the tenant is dropped, like
 * the page it points to (G-8). Pure, so it is tested without a request.
 */
import type { SiteMenuItem } from '@core/module-kit/site-menu';
import { CORE_ICONS } from '@core/ui-theme';

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

/** One item of an admin-assembled header row (`site.topbar`, `site.menubar`), ready to render. */
export interface SiteMenuLink {
  readonly label: string;
  /** Semantic icon name from a `[name]` label prefix, drawn before the label. */
  readonly icon: string | null;
  /** null = plain text (a top-bar notice) or a heading that only opens its submenu. */
  readonly href: string | null;
  readonly external: boolean;
  /** The visitor is on this page or below it. */
  readonly current: boolean;
  /** This item or one of its descendants is current — the trail the menu bar highlights. */
  readonly active: boolean;
  readonly children: readonly SiteMenuLink[];
}

/** Short names an admin may type in a label prefix, mapped to the semantic icon they mean. */
const ICON_ALIASES: Readonly<Record<string, string>> = {
  wa: 'whatsapp',
  tel: 'phone',
  email: 'mail',
};

/**
 * `[wa] +62-812-…` → icon `whatsapp`, label `+62-812-…`. Only registered icon names (or their
 * aliases) count; any other bracketed text stays part of the label, so nothing typed is lost.
 */
export function splitIcon(label: string): { icon: string | null; label: string } {
  const m = /^\[([a-z0-9-]+)\]\s*(.*)$/.exec(label);
  const name = m ? (ICON_ALIASES[m[1] as string] ?? (m[1] as string)) : null;
  if (!m || !name || !CORE_ICONS.includes(name) || !m[2]) return { icon: null, label };
  return { icon: name, label: m[2] };
}

/**
 * Turns a stored `menu` setting into links for the visitor: label in their language, `current`
 * and `active` from the path, and every link into a module the tenant has switched off dropped —
 * with its submenu, like the page it points to (G-8). A heading left with no link and no children
 * goes too, so a menu never shows an empty dropdown.
 */
export function resolveSiteMenu(
  items: readonly SiteMenuItem[],
  opts: {
    locale: string;
    path: string;
    /** The visitor's query string, `?`-prefixed or empty. */
    search: string;
    /** Namespace of the module owning a site path, or null for core / unknown paths. */
    owner: (path: string) => string | null;
    enabled: ReadonlySet<string>;
  },
): SiteMenuLink[] {
  const out: SiteMenuLink[] = [];
  for (const it of items) {
    const href = it.href;
    const internal = !!href?.startsWith('/');
    const pathname = internal ? (href as string).split(/[?#]/)[0] || '/' : null;
    if (pathname) {
      const ns = opts.owner(pathname);
      if (ns && !opts.enabled.has(ns)) continue;
    }
    const children = resolveSiteMenu(it.children, opts);
    if (!href && !children.length && it.children.length) continue;
    // A link with a query (`/catalog?q=arabika`) is one view of a page, so it is current only on
    // exactly that address; a plain path is current on itself and every page below it.
    const query = internal
      ? ((href as string).split('#')[0] ?? '').slice(pathname?.length ?? 0)
      : '';
    const current =
      !!pathname &&
      (query
        ? opts.path === pathname && opts.search === query
        : opts.path === pathname || (pathname !== '/' && opts.path.startsWith(`${pathname}/`)));
    out.push({
      ...splitIcon(opts.locale === 'en' ? it.label.en || it.label.id : it.label.id || it.label.en),
      href,
      external: !!href && !internal,
      current,
      active: current || children.some((c) => c.active),
      children,
    });
  }
  return out;
}
