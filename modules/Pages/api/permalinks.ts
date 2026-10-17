import { SLUG_MAX } from './schemas.ts';

/**
 * Slugs of the Pages module. A page's public URL is `/<slug>`, registered in the core permalink
 * registry (`@app/api/permalinks`, PRD F-12) under the module namespace `pages` with the page id as
 * target — the registry owns uniqueness across modules, the 301 history and resolution. This file
 * only knows what a page slug looks like.
 */
export const MODULE = 'pages';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isSlug(value: string): boolean {
  return value.length > 0 && value.length <= SLUG_MAX && SLUG_RE.test(value);
}

/** `Tentang Kami — 2026!` → `tentang-kami-2026`; a title with no usable letters becomes `page`. */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '');
  return slug || 'page';
}

/** A page's permalink path. */
export const pathOf = (slug: string) => `/${slug}`;
