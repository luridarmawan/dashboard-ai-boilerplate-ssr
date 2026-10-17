import { describe, expect, test } from 'bun:test';
import { renderMarkdown } from '../api/markdown.ts';
import { isSlug, slugify } from '../api/permalinks.ts';

/** Page slugs and the body renderer. The permalink rules themselves are core: apps/api/test/permalinks.test.ts. */
describe('slugs', () => {
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
