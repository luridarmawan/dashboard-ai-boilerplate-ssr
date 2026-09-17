import { describe, expect, test } from 'bun:test';
import { type LazyTarget, planLazy } from './lazy.ts';

/**
 * The decision `class="lazy"` makes per element, kept pure so it can be tested without a DOM.
 * What matters here is the division of labour: an `<img>`/`<iframe>` gets the browser's own
 * `loading="lazy"` and is NOT put on the observer, while a `data-bg`/`data-src` element is — that
 * is the whole point of recommending the native attribute over the class.
 */
const target = (t: Partial<LazyTarget> & { tag: string }): LazyTarget => ({
  hasSrc: false,
  ...t,
});

describe('planLazy', () => {
  test('a div with data-bg is deferred in JavaScript: nothing native can do this', () => {
    const plan = planLazy(target({ tag: 'DIV', dataBg: '/uploads/hero.jpg' }));
    expect(plan.backgroundImage).toBe('url("/uploads/hero.jpg")');
    expect(plan.nativeOnly).toBe(false);
    expect(plan.native).toEqual({});
    expect(plan.advice).toBeUndefined();
  });

  test('a quote or paren in the filename cannot break out of the CSS url()', () => {
    const plan = planLazy(target({ tag: 'DIV', dataBg: '/up/a").b(c\'d.jpg' }));
    expect(plan.backgroundImage).toBe('url("/up/a%22%29.b%28c%27d.jpg")');
  });

  test('an img with data-src defers the fetch and still declares itself lazy', () => {
    const plan = planLazy(target({ tag: 'IMG', dataSrc: '/c.png', dataSrcset: '/c2.png 2x' }));
    expect(plan.deferred).toEqual({ src: '/c.png', srcset: '/c2.png 2x' });
    expect(plan.native).toEqual({ loading: 'lazy', decoding: 'async' });
    expect(plan.nativeOnly).toBe(false);
  });

  test('an img that already has a src is native-only, and dev is told where the attribute goes', () => {
    const plan = planLazy(target({ tag: 'IMG', hasSrc: true }));
    expect(plan.native).toEqual({ loading: 'lazy', decoding: 'async' });
    expect(plan.deferred).toEqual({});
    expect(plan.nativeOnly).toBe(true);
    expect(plan.advice).toContain('loading="lazy"');
  });

  test('an iframe gets loading but not decoding — that attribute is for images', () => {
    const plan = planLazy(target({ tag: 'IFRAME', dataSrc: 'https://example.test/embed' }));
    expect(plan.native).toEqual({ loading: 'lazy' });
    expect(plan.deferred).toEqual({ src: 'https://example.test/embed' });
  });

  test('a div with the class and nothing to load says so instead of failing silently', () => {
    const plan = planLazy(target({ tag: 'DIV' }));
    expect(plan.nativeOnly).toBe(true);
    expect(plan.advice).toContain('data-bg');
  });
});
