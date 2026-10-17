import { describe, expect, test } from 'bun:test';
import { renderMarkdown } from '../api/markdown.ts';
import {
  isSlug,
  isUniqueViolation,
  planSlugChange,
  rootSlug,
  type SlugChangeInput,
  slugify,
} from '../api/permalinks.ts';

/** The permalink rules without a database: every branch of a slug change, and the URL parsing. */
const base: SlugChangeInput = {
  pageId: 'page-a',
  current: 'about-us',
  next: 'about-our-company',
  everPublished: true,
  pageOwner: null,
  redirectOwner: null,
};

describe('planSlugChange', () => {
  test('same slug: nothing to do, and certainly no redirect onto itself', () => {
    expect(planSlugChange({ ...base, next: 'about-us', pageOwner: 'page-a' })).toEqual({
      kind: 'unchanged',
    });
  });

  test('published page, free slug: change and keep the old slug as a redirect', () => {
    expect(planSlugChange(base)).toEqual({ kind: 'change', reclaim: false, redirectOld: true });
  });

  test('never-published draft: change without a redirect', () => {
    expect(planSlugChange({ ...base, everPublished: false })).toEqual({
      kind: 'change',
      reclaim: false,
      redirectOld: false,
    });
  });

  test('slug of another page: conflict', () => {
    expect(planSlugChange({ ...base, pageOwner: 'page-b' })).toEqual({
      kind: 'conflict',
      holder: 'page',
    });
  });

  test('old slug of another page: conflict (it still redirects there)', () => {
    expect(planSlugChange({ ...base, redirectOwner: 'page-b' })).toEqual({
      kind: 'conflict',
      holder: 'redirect',
    });
  });

  test('one of its own old slugs: reclaimed, so it can never redirect to itself', () => {
    expect(planSlugChange({ ...base, redirectOwner: 'page-a' })).toEqual({
      kind: 'change',
      reclaim: true,
      redirectOld: true,
    });
  });
});

describe('slugs and root URLs', () => {
  test('slugify derives a valid slug from any title', () => {
    expect(slugify('About Our Company')).toBe('about-our-company');
    expect(slugify('  Tentang Kami — 2026! ')).toBe('tentang-kami-2026');
    expect(slugify('Café Crème')).toBe('cafe-creme');
    expect(slugify('!!!')).toBe('page');
    expect(slugify('x'.repeat(300)).length).toBe(120);
    for (const title of ['About Our Company', 'Café', '!!!', `${'a-'.repeat(80)}b`])
      expect(isSlug(slugify(title))).toBe(true);
  });

  test('isSlug accepts lower-case words joined by single hyphens only', () => {
    for (const ok of ['about', 'about-us', 'faq-2026', 'a1']) expect(isSlug(ok), ok).toBe(true);
    for (const bad of ['', 'About', 'about--us', '-about', 'about-', 'about us', 'a/b', 'é'])
      expect(isSlug(bad), bad).toBe(false);
  });

  test('rootSlug forgives case, a trailing slash and escapes, and refuses everything deeper', () => {
    expect(rootSlug('/about-us')).toBe('about-us');
    expect(rootSlug('/About-Us/')).toBe('about-us');
    expect(rootSlug('/about%2Dus')).toBe('about-us');
    expect(rootSlug('/about-us?x=1')).toBe('about-us');
    for (const path of ['/', '', '/a/b', '/wp-login.php', '/%E0%A4%A', '/a b', '/../etc'])
      expect(rootSlug(path), path).toBeNull();
  });
});

describe('isUniqueViolation', () => {
  test('recognises each dialect, also when wrapped as a cause', () => {
    expect(isUniqueViolation({ code: 'ER_DUP_ENTRY', errno: 1062 })).toBe(true);
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ code: 'SQLITE_CONSTRAINT_UNIQUE' })).toBe(true);
    expect(isUniqueViolation(new Error('query failed', { cause: { code: 'ER_DUP_ENTRY' } }))).toBe(
      true,
    );
    expect(isUniqueViolation(new Error('timeout'))).toBe(false);
    expect(isUniqueViolation({ code: 'ER_LOCK_DEADLOCK' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe('renderMarkdown', () => {
  test('renders Markdown and strips anything that could run', () => {
    const html = renderMarkdown(
      '# Title\n\nHello **world** [x](https://example.com) [y](javascript:alert(1))\n\n<script>alert(1)</script><img src=x onerror=alert(1)>',
    );
    expect(html).toContain('<h2>Title</h2>');
    expect(html).toContain('<strong>world</strong>');
    expect(html).toContain('<a href="https://example.com">x</a>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('onerror');
    expect(renderMarkdown(null)).toBe('');
    expect(renderMarkdown('   ')).toBe('');
  });
});
