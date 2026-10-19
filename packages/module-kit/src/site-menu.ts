/**
 * The value of a `menu` configuration field: a tree of links an admin assembles in Settings (the
 * public site header's top bar and menu bar are the core users; a module may declare its own
 * `menu` fields). Pure and dependency-free so the Settings editor can run it in the browser too —
 * import it from `@core/module-kit/site-menu`, never from the package root (which pulls in the
 * database layer).
 *
 * Two wire shapes, one stored shape:
 *   - JSON (`SiteMenuItem[]`) — what API clients send and what the store keeps;
 *   - an indented outline — what the Settings form posts, so the field works without JavaScript:
 *
 *       Beranda | Home -> /
 *       Kategori | Categories
 *         Kopi | Coffee -> /kopi
 *           Arabika -> /kopi/arabika
 *       Promo -> https://example.com/promo
 *
 * Two spaces per level; `id | en` labels (one label serves both languages); `-> href` is optional,
 * so an item may be plain text (a top-bar notice) or a heading that only opens its submenu.
 */
export interface SiteMenuItem {
  readonly label: { readonly id: string; readonly en: string };
  /** A site path (`/kopi`), an absolute http(s) URL, `mailto:`/`tel:`, or null for plain text. */
  readonly href: string | null;
  readonly children: readonly SiteMenuItem[];
}

export type SiteMenuParse =
  | { readonly ok: true; readonly items: SiteMenuItem[] }
  | { readonly ok: false; readonly message: string };

export const SITE_MENU_MAX_ITEMS = 200;
export const SITE_MENU_LABEL_MAX = 80;
export const SITE_MENU_HREF_MAX = 512;
/** Hard ceiling on nesting, whatever a field allows: deeper menus are unusable on a phone. */
export const SITE_MENU_DEPTH_MAX = 6;

const HREF_RE = /^(?:\/(?!\/)[^\s]*|https?:\/\/[^\s]+|mailto:[^\s]+|tel:[+0-9() -]+)$/;
/** A host name typed without a scheme (`supplier.carik.id`, `toko.example.com/promo`). */
const BARE_HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#]\S*)?$/i;

/** Admins type domains without `https://`; that is what they mean, so it is stored that way. */
function normalizeHref(href: string): string {
  return BARE_HOST_RE.test(href) ? `https://${href}` : href;
}

function checkHref(href: string): string | null {
  if (href.length > SITE_MENU_HREF_MAX) return `tautan maksimal ${SITE_MENU_HREF_MAX} karakter`;
  if (!HREF_RE.test(href))
    return `tautan "${href}" harus path yang diawali /, URL lengkap (https://…), mailto:, atau tel:`;
  return null;
}

function checkLabel(label: string): string | null {
  if (!label) return 'label tidak boleh kosong';
  if (label.length > SITE_MENU_LABEL_MAX) return `label maksimal ${SITE_MENU_LABEL_MAX} karakter`;
  return null;
}

/** Parses either shape; `maxDepth` 1 means a flat list (no submenus). */
export function parseSiteMenu(input: unknown, maxDepth: number): SiteMenuParse {
  const depth = Math.max(1, Math.min(SITE_MENU_DEPTH_MAX, Math.floor(maxDepth)));
  if (input === null || input === undefined) return { ok: true, items: [] };
  if (Array.isArray(input)) return fromJson(input, depth);
  const text = String(input);
  if (text.trim().startsWith('[')) {
    try {
      return fromJson(JSON.parse(text), depth);
    } catch {
      return { ok: false, message: 'JSON menu tidak valid' };
    }
  }
  return fromOutline(text, depth);
}

function fromJson(raw: unknown, maxDepth: number): SiteMenuParse {
  let count = 0;
  const walk = (list: unknown, level: number): SiteMenuItem[] | string => {
    if (!Array.isArray(list)) return 'menu harus berupa daftar';
    const out: SiteMenuItem[] = [];
    for (const node of list) {
      if (++count > SITE_MENU_MAX_ITEMS) return `menu maksimal ${SITE_MENU_MAX_ITEMS} item`;
      if (!node || typeof node !== 'object') return 'setiap item menu harus objek';
      const n = node as { label?: unknown; href?: unknown; children?: unknown };
      const l = n.label as { id?: unknown; en?: unknown } | string | undefined;
      const id = String((typeof l === 'string' ? l : l?.id) ?? '').trim();
      const en = String((typeof l === 'string' ? l : (l?.en ?? l?.id)) ?? '').trim() || id;
      const labelErr = checkLabel(id) ?? checkLabel(en);
      if (labelErr) return labelErr;
      const href = normalizeHref(
        n.href === null || n.href === undefined ? '' : String(n.href).trim(),
      );
      if (href) {
        const err = checkHref(href);
        if (err) return err;
      }
      const kids = n.children ?? [];
      if (Array.isArray(kids) && kids.length && level >= maxDepth)
        return `"${id}": submenu maksimal ${maxDepth} tingkat`;
      const children = walk(kids, level + 1);
      if (typeof children === 'string') return children;
      out.push({ label: { id, en }, href: href || null, children });
    }
    return out;
  };
  const items = walk(raw, 1);
  return typeof items === 'string' ? { ok: false, message: items } : { ok: true, items };
}

interface Draft {
  label: { id: string; en: string };
  href: string | null;
  children: Draft[];
}

function fromOutline(text: string, maxDepth: number): SiteMenuParse {
  const root: Draft[] = [];
  // stack[i] = the list that items at level i+1 are appended to.
  const stack: Draft[][] = [root];
  let count = 0;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (const [i, raw] of lines.entries()) {
    const line = raw.replace(/\t/g, '  ');
    if (!line.trim()) continue;
    const no = i + 1;
    const indent = line.length - line.trimStart().length;
    if (indent % 2) return { ok: false, message: `baris ${no}: indentasi harus kelipatan 2 spasi` };
    const level = indent / 2 + 1;
    if (level > stack.length)
      return { ok: false, message: `baris ${no}: submenu melompati tingkat di atasnya` };
    if (level > maxDepth)
      return { ok: false, message: `baris ${no}: submenu maksimal ${maxDepth} tingkat` };
    if (++count > SITE_MENU_MAX_ITEMS)
      return { ok: false, message: `menu maksimal ${SITE_MENU_MAX_ITEMS} item` };
    const body = line.trim();
    const arrow = body.lastIndexOf('->');
    const labelPart = (arrow === -1 ? body : body.slice(0, arrow)).trim();
    const href = normalizeHref(arrow === -1 ? '' : body.slice(arrow + 2).trim());
    const bar = labelPart.indexOf('|');
    const id = (bar === -1 ? labelPart : labelPart.slice(0, bar)).trim();
    const en = (bar === -1 ? '' : labelPart.slice(bar + 1)).trim() || id;
    const err = checkLabel(id) ?? checkLabel(en) ?? (href ? checkHref(href) : null);
    if (err) return { ok: false, message: `baris ${no}: ${err}` };
    const item: Draft = { label: { id, en }, href: href || null, children: [] };
    stack.length = level;
    stack[level - 1]?.push(item);
    stack.push(item.children);
  }
  return { ok: true, items: root };
}

/** The outline the Settings textarea shows for a stored menu (inverse of the outline parser). */
export function formatSiteMenu(items: readonly SiteMenuItem[], level = 0): string {
  return items
    .map((it) => {
      const label =
        it.label.en && it.label.en !== it.label.id
          ? `${it.label.id} | ${it.label.en}`
          : it.label.id;
      const line = `${'  '.repeat(level)}${label}${it.href ? ` -> ${it.href}` : ''}`;
      const kids = it.children.length ? `\n${formatSiteMenu(it.children, level + 1)}` : '';
      return line + kids;
    })
    .join('\n');
}

/** Lenient read of a stored value: anything unreadable is an empty menu, never a crash. */
export function storedSiteMenu(value: unknown): SiteMenuItem[] {
  const r = parseSiteMenu(value, SITE_MENU_DEPTH_MAX);
  return r.ok ? r.items : [];
}
