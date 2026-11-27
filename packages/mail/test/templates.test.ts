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
  test('the greeting carries the name, and degrades to a plain "Hello," without one', () => {
    const link = 'https://acme.test/auth/reset?token=abc';
    expect(
      renderTemplate('reset-password', 'en', { name: 'Luri Darmawan', link }, brand).html,
    ).toContain('<p>Hello Luri Darmawan,</p>');
    expect(renderTemplate('reset-password', 'id', { name: 'Budi', link }, brand).html).toContain(
      '<p>Halo Budi,</p>',
    );
    // No name (an imported account, or a caller that has none): no dangling " ," in the mail.
    expect(renderTemplate('reset-password', 'en', { name: '', link }, brand).html).toContain(
      '<p>Hello,</p>',
    );
    expect(renderTemplate('reset-password', 'id', { link }, brand).html).toContain('<p>Halo,</p>');
    expect(renderTemplate('reset-password', 'en', { name: '  ', link }, brand).html).not.toContain(
      'Hello ,',
    );
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
  /** The acknowledgement goes to the VISITOR, so it quotes their own words — escaped like any other. */
  test('contact-ack: thanks the sender in their language and quotes the message back', () => {
    const data = { name: 'Siti', message: 'Halo, saya ingin memesan 10 kg.\nTerima kasih.' };
    const id = renderTemplate('contact-ack', 'id', data, brand);
    const en = renderTemplate('contact-ack', 'en', data, brand);
    expect(id.subject).toBe('Terima kasih, pesan Anda sudah kami terima — Acme Dash');
    expect(en.subject).toBe('Thank you, we have your message — Acme Dash');
    expect(id.html).toContain('Halo Siti,');
    expect(id.html).toContain('Halo, saya ingin memesan 10 kg.<br>Terima kasih.');
    expect(id.text).toContain('Salinan pesan Anda:');
    const evil = renderTemplate(
      'contact-ack',
      'id',
      { name: 'X', message: '<script>alert(1)</script>' },
      brand,
    );
    expect(evil.html).not.toContain('<script>alert(1)');
    expect(evil.html).toContain('&lt;script&gt;');
  });
  /** A module composes the words; the template lays them out and escapes every one of them. */
  test('notice: lays out what a module composed, escaped, with an optional button', () => {
    const r = renderTemplate(
      'notice',
      'id',
      {
        subject: 'Pendaftaran diterima: Liga <Hedef>',
        name: 'Budi & Ani',
        intro: 'Terima kasih.\n\nData Anda:',
        rows: [
          { label: 'Nama', value: '<b>Budi</b>' },
          { label: 'Kosong', value: '  ' },
          { label: 'Kelas', value: 'SD Putra\nZambi' },
        ],
        sections: [{ title: 'Pembayaran', body: 'BCA 123\na.n. Panitia' }],
        link: 'https://osa.test/event/x/payment?t=abc',
        cta: 'Unggah bukti transfer',
        note: 'Email otomatis.',
      },
      brand,
    );
    expect(r.subject).toBe('Pendaftaran diterima: Liga <Hedef> — Acme Dash');
    expect(r.html).toContain('Liga &lt;Hedef&gt;');
    expect(r.html).toContain('Halo Budi &amp; Ani,');
    expect(r.html).toContain('&lt;b&gt;Budi&lt;/b&gt;');
    expect(r.html).not.toContain('<b>Budi');
    expect(r.html).not.toContain('Kosong');
    expect(r.html).toContain('SD Putra<br>Zambi');
    expect(r.html).toContain('BCA 123<br>a.n. Panitia');
    expect(r.html).toContain('Unggah bukti transfer');
    expect(r.text).toContain('Halo Budi & Ani,');
    expect(r.text).toContain('Nama: <b>Budi</b>');
    expect(r.text).toContain('Unggah bukti transfer: https://osa.test/event/x/payment?t=abc');
    const bare = renderTemplate('notice', 'en', { subject: 'Hi' }, brand);
    expect(bare.html).not.toContain('<a href');
    expect(bare.html).not.toContain('Hello');
  });
  test('notice: a section closes with a bold line, escaped, also on its own', () => {
    const r = renderTemplate(
      'notice',
      'id',
      {
        subject: 'Tagihan',
        sections: [
          { title: 'Rincian biaya', body: 'Kelas A: Rp 100.000', strong: 'Total: Rp <100.000>' },
          { title: 'Catatan', body: '', strong: 'Bayar sebelum Jumat' },
        ],
      },
      brand,
    );
    expect(r.html).toContain('Kelas A: Rp 100.000<br><strong>Total: Rp &lt;100.000&gt;</strong>');
    expect(r.html).toContain('<strong>Bayar sebelum Jumat</strong>');
    expect(r.text).toContain('Rincian biaya\nKelas A: Rp 100.000\nTotal: Rp <100.000>');
    expect(r.text).toContain('Catatan\nBayar sebelum Jumat');
  });
  test('notice: web addresses in the text become links, the rest stays escaped', () => {
    const r = renderTemplate(
      'notice',
      'id',
      {
        subject: 'Info',
        intro: 'Grup WA: https://chat.whatsapp.com/AbC123.\nInfo di www.contoh.id/a?b=1&c=<2>, ya',
        sections: [{ body: '(lihat https://contoh.id/x)' }],
        note: 'Tanpa tautan <b>.',
      },
      brand,
    );
    expect(r.html).toContain(
      'Grup WA: <a href="https://chat.whatsapp.com/AbC123">https://chat.whatsapp.com/AbC123</a>.<br>',
    );
    expect(r.html).toContain(
      '<a href="https://www.contoh.id/a?b=1&amp;c=">www.contoh.id/a?b=1&amp;c=</a>&lt;2&gt;, ya',
    );
    expect(r.html).toContain('(lihat <a href="https://contoh.id/x">https://contoh.id/x</a>)');
    expect(r.html).toContain('Tanpa tautan &lt;b&gt;.');
    expect(r.text).toContain('Grup WA: https://chat.whatsapp.com/AbC123.');
  });
  test('notice: a translation follows the first language, sharing the link', () => {
    const r = renderTemplate(
      'notice',
      'id',
      {
        subject: 'Pendaftaran diterima / Registration received: Liga',
        title: 'Pendaftaran diterima',
        name: 'Budi',
        intro: 'Terima kasih.',
        rows: [{ label: 'Tanggal', value: '1 Januari 2027' }],
        link: 'https://osa.test/event/x',
        cta: 'Lihat event',
        note: 'Email otomatis.',
        translation: {
          locale: 'en',
          title: 'Registration <received>',
          name: 'Budi',
          intro: 'Thank you.',
          rows: [{ label: 'Date', value: '1 January 2027' }],
          cta: 'View the event',
          note: 'Automatic e-mail.',
        },
      },
      brand,
    );
    expect(r.subject).toBe('Pendaftaran diterima / Registration received: Liga — Acme Dash');
    const at = (s: string) => r.html.indexOf(s);
    expect(at('Halo Budi,')).toBeGreaterThan(-1);
    expect(at('Registration &lt;received&gt;')).toBeGreaterThan(at('Email otomatis.'));
    expect(at('Hello Budi,')).toBeGreaterThan(at('Registration &lt;received&gt;'));
    expect(at('1 January 2027')).toBeGreaterThan(at('1 Januari 2027'));
    expect(r.html.match(/href="https:\/\/osa\.test\/event\/x"/g)).toHaveLength(3);
    // The raw-link fallback comes once, at the end, in both languages.
    expect(at('If the button does not work')).toBeGreaterThan(at('Automatic e-mail.'));
    expect(at('Bila tombol tidak berfungsi')).toBeGreaterThan(at('Automatic e-mail.'));
    expect(r.text.indexOf('Thank you.')).toBeGreaterThan(r.text.indexOf('Terima kasih.'));
    expect(r.text).toContain('View the event: https://osa.test/event/x');
  });
  test('unknown locale falls back to en, never to an empty string', () => {
    const r = renderTemplate('verify-email', 'fr', { name: 'X', link: 'https://x/y' }, brand);
    expect(r.subject).toContain('Verify');
  });
});
