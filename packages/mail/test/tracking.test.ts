import { describe, expect, test } from 'bun:test';
import { type Brand, renderTemplate } from '../src/index.ts';

/**
 * Engagement tracking in the templates (J-6): the pixel and the tracked button are opt-in per
 * rendering, touch the HTML part only, and never replace the raw link a reader can copy.
 */
const brand: Brand = { appName: 'Acme', primary: '#123456', origin: 'https://acme.test' };
const data = { name: 'Budi', link: 'https://acme.test/auth/verify?token=abc' };

describe('renderTemplate tracking', () => {
  test('without tracking nothing is added', () => {
    const r = renderTemplate('verify-email', 'id', data, brand);
    expect(r.html).not.toContain('/v1/mail/o/');
    expect(r.html).not.toContain('/v1/mail/c/');
    expect(r.html).toContain('href="https://acme.test/auth/verify?token=abc"');
  });

  test('pixel goes at the end of the body; the button is wrapped, the fallback link is not', () => {
    const r = renderTemplate('verify-email', 'en', data, brand, {
      pixelUrl: 'https://acme.test/v1/mail/o/0123456789abcdef0123456789abcdef.gif',
      buttonUrl: 'https://acme.test/v1/mail/c/0123456789abcdef0123456789abcdef',
    });
    expect(r.html).toContain(
      '<img src="https://acme.test/v1/mail/o/0123456789abcdef0123456789abcdef.gif" width="1" height="1" alt=""',
    );
    expect(r.html.indexOf('/v1/mail/o/')).toBeGreaterThan(r.html.indexOf('</table>'));
    // The button carries the tracked URL; the "copy this link" line keeps the raw one.
    expect(r.html).toContain('href="https://acme.test/v1/mail/c/0123456789abcdef0123456789abcdef"');
    expect(r.html).toContain('href="https://acme.test/auth/verify?token=abc"');
    // The text alternative is untouched: no pixel, no redirect.
    expect(r.text).toContain('https://acme.test/auth/verify?token=abc');
    expect(r.text).not.toContain('/v1/mail/');
  });

  test('a mail without a link gets the pixel only', () => {
    const r = renderTemplate('contact-ack', 'id', { name: 'Budi', message: 'halo' }, brand, {
      pixelUrl: 'https://acme.test/v1/mail/o/x.gif',
    });
    expect(r.html).toContain('/v1/mail/o/x.gif');
    expect(r.html).not.toContain('/v1/mail/c/');
  });
});
