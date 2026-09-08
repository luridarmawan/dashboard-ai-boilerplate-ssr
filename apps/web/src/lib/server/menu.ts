import type { Locale } from '@core/i18n';
import { moduleMenu } from '@core/module-kit/registry';
import type { Session } from './session.ts';

/**
 * The dashboard menu (PRD F-1…F-4): core entries + module entries (from `modules:sync`), then
 * FILTERED by the user's effective permissions on the server — an entry the user may not see is
 * never sent to the client (the API refuses it anyway, C-6). Resolved during SSR so the sidebar
 * is right in the first HTML (F-2). Layouts receive the result and only arrange it.
 */
export interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly icon: string;
  readonly order: number;
  readonly badge?: string | number;
  readonly children: MenuItem[];
  readonly active: boolean;
}

interface Entry {
  id: string;
  label: { id: string; en: string };
  href: string;
  icon?: string;
  permission?: string;
  order?: number;
  parent?: string;
}

/** Core entries use order 0–99; modules default to 100+ (module-kit convention). */
export const CORE_MENU: readonly Entry[] = [
  {
    id: 'core.dashboard',
    label: { id: 'Dasbor', en: 'Dashboard' },
    href: '/dashboard',
    icon: 'dashboard',
    order: 0,
  },
  {
    id: 'core.users',
    label: { id: 'Pengguna', en: 'Users' },
    href: '/users',
    icon: 'users',
    permission: 'user.read',
    order: 10,
  },
  {
    id: 'core.groups',
    label: { id: 'Grup & izin', en: 'Groups & permissions' },
    href: '/groups',
    icon: 'shield',
    permission: 'group.read',
    order: 20,
  },
  {
    id: 'core.tenants',
    label: { id: 'Tenant', en: 'Tenants' },
    href: '/tenants',
    icon: 'building',
    permission: 'client.read',
    order: 30,
  },
  {
    id: 'core.themes',
    label: { id: 'Tema kustom', en: 'Custom themes' },
    href: '/themes',
    icon: 'palette',
    permission: 'theme.manage',
    order: 40,
  },
  {
    id: 'core.webhooks',
    label: { id: 'Webhook keluar', en: 'Outgoing webhooks' },
    href: '/webhooks',
    icon: 'link',
    permission: 'webhook.read',
    order: 45,
  },
  {
    id: 'core.profile',
    label: { id: 'Profil', en: 'Profile' },
    href: '/profile',
    icon: 'user',
    order: 90,
  },
];

export function buildMenu(
  session: Session,
  pathname: string,
  locale: Locale = 'id',
  enabledModules?: ReadonlySet<string>,
): MenuItem[] {
  // G-8: entries of a module disabled for this tenant are not built at all.
  const moduleEntries = moduleMenu.filter(
    (e) => !enabledModules || enabledModules.has(e.id.split('.')[0] ?? ''),
  );
  const all: Entry[] = [...CORE_MENU, ...moduleEntries];
  const allowed = all.filter((e) => !e.permission || session.can(e.permission));
  const byId = new Map<string, MenuItem>();
  const toItem = (e: Entry): MenuItem => ({
    id: e.id,
    label: e.label[locale] ?? e.label.id,
    href: e.href,
    icon: e.icon ?? 'puzzle',
    order: e.order ?? 100,
    children: [],
    active: pathname === e.href || (e.href !== '/' && pathname.startsWith(`${e.href}/`)),
  });
  for (const e of allowed) byId.set(e.id, toItem(e));
  const roots: MenuItem[] = [];
  for (const e of allowed) {
    const item = byId.get(e.id) as MenuItem;
    const parent = e.parent ? byId.get(e.parent) : undefined;
    if (parent)
      parent.children.push(item); // one level of nesting (F-3)
    else roots.push(item);
  }
  const sort = (list: MenuItem[]) => {
    list.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
    for (const i of list) sort(i.children);
  };
  sort(roots);
  return roots.map((r) => ({ ...r, active: r.active || r.children.some((c) => c.active) }));
}

export interface Crumb {
  readonly label: string;
  readonly href: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Breadcrumb from the route structure (F-4); menu labels where known, the segment otherwise. */
export function buildBreadcrumb(
  pathname: string,
  menu: MenuItem[],
  locale: Locale = 'id',
): Crumb[] {
  const labels = new Map<string, string>();
  const collect = (list: MenuItem[]) => {
    for (const m of list) {
      labels.set(m.href, m.label);
      collect(m.children);
    }
  };
  collect(menu);
  const segments = pathname.split('/').filter(Boolean);
  const crumbs: Crumb[] = [{ label: locale === 'en' ? 'Home' : 'Beranda', href: '/dashboard' }];
  let acc = '';
  segments.forEach((seg, i) => {
    acc += `/${seg}`;
    if (acc === '/dashboard') return;
    const last = i === segments.length - 1;
    const label =
      labels.get(acc) ??
      (UUID_RE.test(seg)
        ? locale === 'en'
          ? 'Detail'
          : 'Detail'
        : seg === 'new'
          ? locale === 'en'
            ? 'New'
            : 'Baru'
          : seg.charAt(0).toUpperCase() + seg.slice(1));
    crumbs.push({ label, href: last ? null : acc });
  });
  return crumbs;
}
