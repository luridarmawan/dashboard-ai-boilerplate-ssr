import type { Locale } from '@core/i18n';
import { moduleMenu, modules } from '@core/module-kit/registry';
import type { Session } from './session.ts';

/**
 * The dashboard menu (PRD F-1…F-4): core entries + module entries (from `modules:sync`), then
 * FILTERED by the user's effective permissions on the server — an entry the user may not see is
 * never sent to the client (the API refuses it anyway, C-6). Resolved during SSR so the sidebar
 * is right in the first HTML (F-2). Layouts receive the result and only arrange it.
 *
 * Shape (F-3): a short top level (Dashboard, the AI assistant, Profile) followed by collapsible
 * GROUPS — the shared core groups Settings / Integration / Monitoring, and one group per module
 * for entries that name no group (title from module.json `menu.label`, else the module name).
 * A group whose entries are all hidden is not built; a group with an active entry is rendered open.
 */
export interface MenuItem {
  readonly id: string;
  readonly kind: 'link' | 'group';
  readonly label: string;
  /** Empty for a group. */
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
  /** undefined → the owning module's group; null → top level; string → a core group id. */
  group?: string | null;
  /** Module name for module entries; absent for core. */
  module?: string;
}

interface GroupDef {
  id: string;
  label: { id: string; en: string };
  icon: string;
  order: number;
}

/** Shared groups. Module groups sort between `integration` and `monitoring` (default order 100). */
export const CORE_GROUPS: readonly GroupDef[] = [
  { id: 'settings', label: { id: 'Pengaturan', en: 'Settings' }, icon: 'settings', order: 10 },
  { id: 'integration', label: { id: 'Integrasi', en: 'Integration' }, icon: 'plug', order: 20 },
  {
    id: 'monitoring',
    label: { id: 'Pemantauan', en: 'Monitoring' },
    icon: 'chart-line',
    order: 900,
  },
];

/** Core entries use order 0–99; modules default to 100+ (module-kit convention). */
export const CORE_MENU: readonly Entry[] = [
  {
    id: 'core.dashboard',
    label: { id: 'Dasbor', en: 'Dashboard' },
    href: '/dashboard',
    icon: 'dashboard',
    order: 0,
    group: null,
  },
  {
    id: 'core.profile',
    label: { id: 'Profil', en: 'Profile' },
    href: '/profile',
    icon: 'user',
    order: 90,
    group: null,
  },
  {
    id: 'core.users',
    label: { id: 'Pengguna', en: 'Users' },
    href: '/users',
    icon: 'users',
    permission: 'user.read',
    order: 10,
    group: 'settings',
  },
  {
    id: 'core.groups',
    label: { id: 'Grup & izin', en: 'Groups & permissions' },
    href: '/groups',
    icon: 'shield',
    permission: 'group.read',
    order: 20,
    group: 'settings',
  },
  {
    id: 'core.tenants',
    label: { id: 'Tenant', en: 'Tenants' },
    href: '/tenants',
    icon: 'building',
    permission: 'client.read',
    order: 30,
    group: 'settings',
  },
  {
    id: 'core.themes',
    label: { id: 'Tema kustom', en: 'Custom themes' },
    href: '/themes',
    icon: 'palette',
    permission: 'theme.manage',
    order: 40,
    group: 'settings',
  },
  {
    id: 'core.settings',
    label: { id: 'Pengaturan', en: 'Settings' },
    href: '/settings',
    icon: 'settings',
    permission: 'config.read',
    order: 42,
    group: 'settings',
  },
  {
    id: 'core.modules',
    label: { id: 'Modul', en: 'Modules' },
    href: '/modules',
    icon: 'puzzle',
    permission: 'module.read',
    order: 44,
    group: 'settings',
  },
  {
    id: 'core.webhooks',
    label: { id: 'Webhook keluar', en: 'Outgoing webhooks' },
    href: '/webhooks',
    icon: 'link',
    permission: 'webhook.read',
    order: 45,
    group: 'integration',
  },
  {
    id: 'core.queue',
    label: { id: 'Antrean pekerjaan', en: 'Job queue' },
    href: '/queue',
    icon: 'clock',
    permission: 'queue.read',
    order: 46,
    group: 'monitoring',
  },
];

/** Every group that can exist: the core ones plus one per installed module. */
function allGroups(): GroupDef[] {
  const perModule: GroupDef[] = modules.map((m) => {
    const custom = (
      m as { menuGroup?: { label: { id: string; en: string }; order?: number } | null }
    ).menuGroup;
    return {
      id: m.ns,
      label: custom?.label ?? { id: m.name, en: m.name },
      icon: 'puzzle',
      order: custom?.order ?? 100,
    };
  });
  return [...CORE_GROUPS, ...perModule];
}

export function buildMenu(
  session: Session,
  pathname: string,
  locale: Locale = 'id',
  enabledModules?: ReadonlySet<string>,
): MenuItem[] {
  // G-8: entries of a module disabled for this tenant are not built at all.
  const moduleEntries: Entry[] = moduleMenu.filter(
    (e) => !enabledModules || enabledModules.has(e.id.split('.')[0] ?? ''),
  );
  const all: Entry[] = [...CORE_MENU, ...moduleEntries];
  const allowed = all.filter((e) => !e.permission || session.can(e.permission));
  const isActive = (href: string) =>
    pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
  const toItem = (e: Entry): MenuItem => ({
    id: e.id,
    kind: 'link',
    label: e.label[locale] ?? e.label.id,
    href: e.href,
    icon: e.icon ?? 'puzzle',
    order: e.order ?? 100,
    children: [],
    active: isActive(e.href),
  });
  const byId = new Map<string, MenuItem>();
  for (const e of allowed) byId.set(e.id, toItem(e));

  // Effective group of an entry: explicit id, null for the top level, else the owning module.
  const groupOf = (e: Entry): string | null =>
    e.group === undefined ? (e.module ?? e.id.split('.')[0] ?? null) : e.group;
  const groups = new Map<string, MenuItem>();
  const groupDefs = new Map(allGroups().map((g) => [g.id, g]));
  const roots: MenuItem[] = [];
  for (const e of allowed) {
    const item = byId.get(e.id) as MenuItem;
    // One level of nesting under another entry (F-3) stays inside that entry.
    const parent = e.parent ? byId.get(e.parent) : undefined;
    if (parent) {
      parent.children.push(item);
      continue;
    }
    const gid = groupOf(e);
    const def = gid ? groupDefs.get(gid) : undefined;
    if (!gid || !def) {
      roots.push(item);
      continue;
    }
    let g = groups.get(gid);
    if (!g) {
      g = {
        id: `group.${gid}`,
        kind: 'group',
        label: def.label[locale] ?? def.label.id,
        href: '',
        icon: def.icon,
        order: def.order,
        children: [],
        active: false,
      };
      groups.set(gid, g);
    }
    g.children.push(item);
  }
  const sort = (list: MenuItem[]) => {
    list.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
    for (const i of list) sort(i.children);
  };
  const withActive = (i: MenuItem): MenuItem => ({
    ...i,
    children: i.children.map(withActive),
    active: i.active || i.children.some((c) => c.active || c.children.some((x) => x.active)),
  });
  sort(roots);
  const groupList = [...groups.values()];
  sort(groupList);
  // Top-level links first, then the groups — the sidebar stays short (F-3).
  return [...roots, ...groupList].map(withActive);
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
      if (m.href) labels.set(m.href, m.label);
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
