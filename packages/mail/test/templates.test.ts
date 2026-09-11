import { describe, expect, test } from 'bun:test';
import { renderTemplate } from '../src/templates/index.ts';

const brand = {
  appName: 'Acme Dash',
  logoUrl: null,
  primary: '#2563eb',
  origin: 'https://acme.test',
};

describe('email templates are i18n + branded (J-3)', () => {
  test('locale changes the copy; the brand colour and name come from the caller', () => {
    const id = renderTemplate(
      'reset-password',
      'id',
      { name: 'Budi', link: 'https://acme.test/auth/reset?token=abc' },
      brand,
    );
    const en = renderTemplate(
      'reset-password',
      'en',
      { name: 'Budi', link: 'https://acme.test/auth/reset?token=abc' },
      brand,
    );
    expect(id.subject).toBe('Atur ulang kata sandi — Acme Dash');
    expect(en.subject).toBe('Reset your password — Acme Dash');
    expect(id.html).toContain('#2563eb');
    expect(id.html).toContain('Acme Dash');
    expect(id.text).toContain('https://acme.test/auth/reset?token=abc');
  });
  test('the header carries the app name, beside the logo when there is one', () => {
    const plain = renderTemplate('invite', 'id', { link: 'https://acme.test/join/abc' }, brand);
    expect(plain.html).toContain('>Acme Dash</strong>');
    const withLogo = renderTemplate(
      'invite',
      'id',
      { link: 'https://acme.test/join/abc' },
      {
        ...brand,
        logoUrl: 'https://acme.test/logo.png',
      },
    );
    const head = withLogo.html.slice(0, withLogo.html.indexOf('<h1'));
    expect(head).toContain('https://acme.test/logo.png');
    expect(head).toContain('>Acme Dash</strong>');
    // The logo is decorative now that the name is spelled out next to it.
    expect(head).toContain('alt=""');
  });
  test('user-supplied text is escaped in HTML', () => {
    const r = renderTemplate(
      'contact',
      'en',
      { name: '<img src=x onerror=alert(1)>', email: 'a@b.co', message: 'hi <b>there</b>' },
      brand,
    );
    expect(r.html).not.toContain('<img src=x');
    expect(r.html).toContain('&lt;img src=x');
    expect(r.html).toContain('hi &lt;b&gt;there&lt;/b&gt;');
  });
  test('unknown locale falls back to id, never to an empty string', () => {
    const r = renderTemplate('verify-email', 'fr', { name: 'X', link: 'https://x/y' }, brand);
    expect(r.subject).toContain('Verifikasi');
  });
});
