/**
 * Email templates (PRD J-3): i18n (`id`/`en`) and branded — the app name, logo and primary
 * colour come from the ACTIVE theme/config at send time, so a template never hardcodes either.
 * Plain HTML with inline styles (email clients), plus a text alternative.
 */
export interface Brand {
  readonly appName: string;
  readonly logoUrl?: string | null;
  /** Hex colour from the theme's --primary token. */
  readonly primary: string;
  readonly origin: string;
}

export interface Rendered {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

/**
 * Engagement tracking for ONE rendering (J-6). Both are opt-in per tenant and only touch the
 * HTML part: the text alternative and the "copy this link" fallback keep the raw link, so a
 * reader who distrusts tracked links still has a clean one — and the one-time token behind
 * that link records the visit anyway.
 */
export interface Tracking {
  /** Absolute URL of the 1×1 image appended to the body. */
  readonly pixelUrl?: string | undefined;
  /** Absolute URL the call-to-action button points at instead of the raw link. */
  readonly buttonUrl?: string | undefined;
}

export type TemplateId =
  | 'verify-email'
  | 'reset-password'
  | 'set-password'
  | 'invite'
  | 'invite-existing'
  | 'contact'
  | 'contact-ack'
  | 'notice';

/**
 * Payload of the generic `notice` template: a module composes the message in the recipient's
 * language and the template only lays it out (and escapes every string). This is how a module
 * sends mail of its own without a template in core.
 */
export interface NoticeData {
  /** Subject line; ` — <app name>` is appended. */
  readonly subject: string;
  /** Heading of the message; the subject when empty. */
  readonly title?: string;
  /** Greets the recipient by name ("Hello Budi,"); empty = a plain greeting, absent = none. */
  readonly name?: string;
  /** Paragraphs before the table; blank lines separate paragraphs. */
  readonly intro?: string;
  /** Label/value pairs shown as a table (the data a form sent, an order, …). */
  readonly rows?: readonly { readonly label: string; readonly value: string }[];
  /**
   * Titled blocks after the table; line breaks are kept. `strong` is a closing line shown in bold
   * below the body (a total, a deadline).
   */
  readonly sections?: readonly {
    readonly title?: string;
    readonly body: string;
    readonly strong?: string;
  }[];
  /** Call to action: `link` with `cta` as the button label (tracked like the other templates). */
  readonly link?: string;
  readonly cta?: string;
  /** Small print at the end. */
  readonly note?: string;
  /**
   * The same message in a second language, laid out below the first after a divider (a
   * bilingual mail). It shares the subject and the link; the subject should name both languages.
   */
  readonly translation?: NoticeTranslation;
}

/** The body of a notice in another language: its own words, the parent's link. */
export interface NoticeTranslation extends Omit<NoticeData, 'subject' | 'link' | 'translation'> {
  readonly locale: string;
}

type Dict = Record<string, string>;
const T: Record<'id' | 'en', Dict> = {
  id: {
    hello: 'Halo {name},',
    'hello.anon': 'Halo,',
    'verify.subject': 'Verifikasi email Anda — {app}',
    'verify.body':
      'Terima kasih telah mendaftar. Klik tombol di bawah untuk memverifikasi alamat email Anda.',
    'verify.cta': 'Verifikasi email',
    'reset.subject': 'Atur ulang kata sandi — {app}',
    'reset.body':
      'Kami menerima permintaan untuk mengatur ulang kata sandi Anda. Tautan ini berlaku 1 jam dan hanya sekali pakai.',
    'reset.cta': 'Atur ulang kata sandi',
    'set.subject': 'Selamat datang di {app} — atur kata sandi Anda',
    'set.body':
      'Akun Anda telah dibuat oleh administrator. Atur kata sandi Anda lewat tombol di bawah (berlaku 24 jam).',
    'set.cta': 'Atur kata sandi',
    'invite.subject': 'Undangan bergabung ke {tenant} — {app}',
    'invite.body': '{inviter} mengundang Anda bergabung ke {tenant}.',
    'invite.cta': 'Terima undangan',
    'invite.expires': 'Tautan ini berlaku {hours} jam.',
    'invite_existing.subject': 'Anda sudah punya akun di {app}',
    'invite_existing.body':
      '{inviter} mengundang Anda bergabung ke {tenant}. Alamat email ini sudah terdaftar, jadi cukup masuk dengan akun Anda — tenant tersebut sudah ditambahkan. Lupa kata sandi? Gunakan "Lupa kata sandi" di halaman masuk.',
    'invite_existing.cta': 'Masuk',
    'contact.subject': 'Pesan baru dari {name} — {app}',
    'contact.body': 'Pesan masuk lewat formulir kontak:',
    'contact.reply': 'Balas ke',
    'contact_ack.subject': 'Terima kasih, pesan Anda sudah kami terima',
    'contact_ack.body':
      'Terima kasih sudah menghubungi kami. Pesan Anda sudah masuk dan tim kami akan membalas ke alamat email ini.',
    'contact_ack.copy': 'Salinan pesan Anda:',
    'contact_ack.noreply':
      'Email ini dikirim otomatis sebagai tanda terima — Anda tidak perlu membalasnya.',
    ignore: 'Jika Anda tidak meminta ini, abaikan email ini.',
    footer: 'Email ini dikirim oleh {app}.',
    'link.fallback': 'Bila tombol tidak berfungsi, salin tautan ini ke peramban:',
  },
  en: {
    hello: 'Hello {name},',
    'hello.anon': 'Hello,',
    'verify.subject': 'Verify your email — {app}',
    'verify.body': 'Thanks for signing up. Click the button below to verify your email address.',
    'verify.cta': 'Verify email',
    'reset.subject': 'Reset your password — {app}',
    'reset.body':
      'We received a request to reset your password. This link is valid for 1 hour and can be used once.',
    'reset.cta': 'Reset password',
    'set.subject': 'Welcome to {app} — set your password',
    'set.body':
      'An administrator created your account. Set your password with the button below (valid 24 hours).',
    'set.cta': 'Set password',
    'invite.subject': 'You are invited to {tenant} — {app}',
    'invite.body': '{inviter} invited you to join {tenant}.',
    'invite.cta': 'Accept invitation',
    'invite.expires': 'This link is valid for {hours} hours.',
    'invite_existing.subject': 'You already have an account at {app}',
    'invite_existing.body':
      '{inviter} invited you to join {tenant}. This e-mail address is already registered, so simply sign in with your account — that tenant has been added for you. Forgot your password? Use "Forgot password" on the sign-in page.',
    'invite_existing.cta': 'Sign in',
    'contact.subject': 'New message from {name} — {app}',
    'contact.body': 'A message arrived through the contact form:',
    'contact.reply': 'Reply to',
    'contact_ack.subject': 'Thank you, we have your message',
    'contact_ack.body':
      'Thanks for getting in touch. Your message reached us and our team will reply to this address.',
    'contact_ack.copy': 'A copy of your message:',
    'contact_ack.noreply':
      'This is an automatic acknowledgement — there is no need to reply to it.',
    ignore: 'If you did not request this, you can ignore this email.',
    footer: 'This email was sent by {app}.',
    'link.fallback': 'If the button does not work, paste this link into your browser:',
  },
};

function tr(locale: string, key: string, params: Record<string, unknown> = {}): string {
  const dict = T[locale === 'id' ? 'id' : 'en'];
  const s = dict[key] ?? T.id[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (m, k: string) =>
    k in params ? escapeHtml(String(params[k])) : m,
  );
}
/** The opening line — "Hello Budi," — or a plain "Hello," when the caller has no name to show. */
function greeting(locale: string, name: string): string {
  const n = name.trim();
  return n ? tr(locale, 'hello', { name: n }) : tr(locale, 'hello.anon');
}
function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

function shell(
  brand: Brand,
  locale: string,
  title: string,
  bodyHtml: string,
  pixelUrl?: string,
): string {
  // The app name always shows; with a logo it sits to its right, in a two-cell table because
  // Outlook ignores flex and inline-block alignment. `alt=""` keeps the name from being read twice.
  const name = `<strong style="font-size:18px;color:${brand.primary}">${escapeHtml(brand.appName)}</strong>`;
  const header = brand.logoUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0"><tr>` +
      `<td style="padding-right:12px;vertical-align:middle"><img src="${escapeHtml(brand.logoUrl)}" alt="" height="32" style="height:32px;display:block"></td>` +
      `<td style="vertical-align:middle">${name}</td></tr></table>`
    : name;
  return `<!doctype html><html lang="${locale}"><body style="margin:0;background:#f4f4f5;font-family:system-ui,Segoe UI,Roboto,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="padding:24px 32px;border-bottom:4px solid ${brand.primary}">${header}</td></tr>
<tr><td style="padding:32px"><h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(title)}</h1>${bodyHtml}</td></tr>
<tr><td style="padding:16px 32px;background:#fafafa;color:#71717a;font-size:12px">${tr(locale, 'footer', { app: brand.appName })}</td></tr>
</table></td></tr></table>${pixelUrl ? `<img src="${escapeHtml(pixelUrl)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">` : ''}</body></html>`;
}
const button = (href: string, label: string, color: string) =>
  `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${label}</a></p>`;
const fallback = (locale: string, href: string, also: string | null = null) =>
  `<p style="color:#71717a;font-size:12px">${tr(locale, 'link.fallback')}${also && also !== locale ? `<br>${tr(also, 'link.fallback')}` : ''}<br><a href="${escapeHtml(href)}" style="color:#71717a">${escapeHtml(href)}</a></p>`;

export function renderTemplate(
  id: TemplateId,
  locale: string,
  data: Record<string, unknown>,
  brand: Brand,
  track: Tracking = {},
): Rendered {
  const app = brand.appName;
  const name = String(data.name ?? '');
  const link = String(data.link ?? '');
  /** What the button points at: the tracked redirect when asked for, else the link itself. */
  const cta = track.buttonUrl ?? link;
  const shellHtml = (locale: string, subject: string, body: string) =>
    shell(brand, locale, subject, body, track.pixelUrl);
  switch (id) {
    case 'verify-email': {
      const subject = tr(locale, 'verify.subject', { app });
      const body = `<p>${greeting(locale, name)}</p><p>${tr(locale, 'verify.body')}</p>${button(cta, tr(locale, 'verify.cta'), brand.primary)}${fallback(locale, link)}<p style="color:#71717a">${tr(locale, 'ignore')}</p>`;
      return {
        subject,
        html: shellHtml(locale, subject, body),
        text: `${tr(locale, 'verify.body')}\n\n${link}\n\n${tr(locale, 'ignore')}`,
      };
    }
    case 'reset-password': {
      const subject = tr(locale, 'reset.subject', { app });
      const body = `<p>${greeting(locale, name)}</p><p>${tr(locale, 'reset.body')}</p>${button(cta, tr(locale, 'reset.cta'), brand.primary)}${fallback(locale, link)}<p style="color:#71717a">${tr(locale, 'ignore')}</p>`;
      return {
        subject,
        html: shellHtml(locale, subject, body),
        text: `${tr(locale, 'reset.body')}\n\n${link}`,
      };
    }
    case 'set-password': {
      const subject = tr(locale, 'set.subject', { app });
      const body = `<p>${greeting(locale, name)}</p><p>${tr(locale, 'set.body')}</p>${button(cta, tr(locale, 'set.cta'), brand.primary)}${fallback(locale, link)}`;
      return {
        subject,
        html: shellHtml(locale, subject, body),
        text: `${tr(locale, 'set.body')}\n\n${link}`,
      };
    }
    case 'invite': {
      const subject = tr(locale, 'invite.subject', { app, tenant: String(data.tenant ?? '') });
      const hours =
        data.hours === undefined
          ? ''
          : `<p>${tr(locale, 'invite.expires', { hours: String(data.hours) })}</p>`;
      const body = `<p>${greeting(locale, name)}</p><p>${tr(locale, 'invite.body', { inviter: String(data.inviter ?? ''), tenant: String(data.tenant ?? '') })}</p>${hours}${button(cta, tr(locale, 'invite.cta'), brand.primary)}${fallback(locale, link)}`;
      return {
        subject,
        html: shellHtml(locale, subject, body),
        text: `${tr(locale, 'invite.body', { inviter: String(data.inviter ?? ''), tenant: String(data.tenant ?? '') })}\n\n${link}`,
      };
    }
    case 'invite-existing': {
      const vars = { inviter: String(data.inviter ?? ''), tenant: String(data.tenant ?? '') };
      const subject = tr(locale, 'invite_existing.subject', { app });
      const body = `<p>${greeting(locale, name)}</p><p>${tr(locale, 'invite_existing.body', vars)}</p>${button(cta, tr(locale, 'invite_existing.cta'), brand.primary)}${fallback(locale, link)}`;
      return {
        subject,
        html: shellHtml(locale, subject, body),
        text: `${tr(locale, 'invite_existing.body', vars)}\n\n${link}`,
      };
    }
    case 'contact-ack': {
      // To the VISITOR, not to the inbox behind the form: everything here is either brand copy or
      // the visitor's own words quoted back, so they can see exactly what arrived.
      const subject = `${tr(locale, 'contact_ack.subject')} — ${app}`;
      const msg = escapeHtml(String(data.message ?? '')).replace(/\n/g, '<br>');
      const body = `<p>${greeting(locale, name)}</p><p>${tr(locale, 'contact_ack.body')}</p><p style="color:#71717a;font-size:13px;margin-bottom:4px">${tr(locale, 'contact_ack.copy')}</p><blockquote style="margin:4px 0 24px;padding:12px 16px;border-left:4px solid ${brand.primary};background:#fafafa">${msg}</blockquote><p style="color:#71717a;font-size:12px">${tr(locale, 'contact_ack.noreply')}</p>`;
      return {
        subject,
        html: shellHtml(locale, subject, body),
        text: `${tr(locale, 'contact_ack.body')}\n\n${tr(locale, 'contact_ack.copy')}\n${String(data.message ?? '')}\n\n${tr(locale, 'contact_ack.noreply')}`,
      };
    }
    case 'notice':
      return renderNotice(locale, data as unknown as NoticeData, brand, cta, shellHtml);
    case 'contact': {
      const subject = tr(locale, 'contact.subject', { app, name });
      const msg = escapeHtml(String(data.message ?? '')).replace(/\n/g, '<br>');
      const body = `<p>${tr(locale, 'contact.body')}</p><blockquote style="margin:16px 0;padding:12px 16px;border-left:4px solid ${brand.primary};background:#fafafa">${msg}</blockquote><p><strong>${tr(locale, 'contact.reply')}:</strong> ${escapeHtml(name)} &lt;${escapeHtml(String(data.email ?? ''))}&gt;</p>`;
      return {
        subject,
        html: shellHtml(locale, subject, body),
        text: `${tr(locale, 'contact.body')}\n\n${String(data.message ?? '')}\n\n${tr(locale, 'contact.reply')}: ${name} <${String(data.email ?? '')}>`,
      };
    }
  }
}

/**
 * A web address in text a module (or a person, through it) wrote: `http(s)://…` or `www.…`, up
 * to whitespace or a bracket. Punctuation that ends a sentence is not part of it.
 */
const URL_IN_TEXT = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const TRAILING = /[.,;:!?)\]}'"]+$/;

/** Text with its line breaks and its web addresses as links, safe for HTML. */
function multiline(s: string): string {
  let out = '';
  let at = 0;
  for (const m of s.matchAll(URL_IN_TEXT)) {
    const start = m.index ?? 0;
    const url = m[0].replace(TRAILING, '');
    const href = /^www\./i.test(url) ? `https://${url}` : url;
    out += `${escapeHtml(s.slice(at, start))}<a href="${escapeHtml(href)}">${escapeHtml(url)}</a>`;
    at = start + url.length;
  }
  return (out + escapeHtml(s.slice(at))).replace(/\r?\n/g, '<br>');
}
const str = (v: unknown) =>
  typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);

function renderNotice(
  locale: string,
  d: NoticeData,
  brand: Brand,
  cta: string,
  shellHtml: (locale: string, subject: string, body: string) => string,
): Rendered {
  const subject = `${str(d.subject)} — ${brand.appName}`;
  const title = str(d.title) || str(d.subject);
  const link = str(d.link);
  const alt = d.translation && typeof d.translation === 'object' ? d.translation : null;
  const first = noticeBody(locale, d, link, brand, cta);
  const html = [...first.html];
  const text = [...first.text];
  if (alt) {
    const altLocale = str(alt.locale) || 'en';
    const second = noticeBody(altLocale, alt, link, brand, cta);
    const altTitle = str(alt.title);
    html.push(
      `<hr style="margin:32px 0;border:0;border-top:1px solid #e4e4e7">`,
      altTitle
        ? `<h2 lang="${escapeHtml(altLocale)}" style="margin:0 0 16px;font-size:18px">${escapeHtml(altTitle)}</h2>`
        : '',
      ...second.html,
    );
    text.push('— — —', ...(altTitle ? [altTitle] : []), ...second.text);
  }
  // The raw-link fallback once, at the very end, in every language the mail speaks.
  if (link) {
    html.push(fallback(locale, link, alt ? str(alt.locale) || 'en' : null));
  }
  return { subject, html: shellHtml(locale, title, html.join('')), text: text.join('\n\n') };
}

/** Greeting, paragraphs, table, sections, button and small print of one language. */
function noticeBody(
  locale: string,
  d: Omit<NoticeData, 'subject' | 'link'>,
  link: string,
  brand: Brand,
  cta: string,
): { html: string[]; text: string[] } {
  const html: string[] = [];
  const text: string[] = [];
  if (d.name !== undefined) {
    const name = str(d.name).trim();
    html.push(`<p>${greeting(locale, name)}</p>`);
    // The text part carries the name as typed, not HTML-escaped.
    const dict = T[locale === 'id' ? 'id' : 'en'];
    text.push(name ? (dict.hello ?? '').replace('{name}', name) : (dict['hello.anon'] ?? ''));
  }
  const paragraphs = str(d.intro)
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const para of paragraphs) {
    html.push(`<p>${multiline(para)}</p>`);
    text.push(para);
  }
  const rows = Array.isArray(d.rows) ? d.rows.filter((r) => r && str(r.value).trim()) : [];
  if (rows.length) {
    const cell = 'padding:6px 0;vertical-align:top;border-bottom:1px solid #f4f4f5';
    html.push(
      `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:16px 0;border-collapse:collapse;font-size:14px">${rows
        .map(
          (r) =>
            `<tr><td style="${cell};padding-right:12px;color:#71717a;white-space:nowrap">${escapeHtml(str(r.label))}</td><td style="${cell}">${multiline(str(r.value))}</td></tr>`,
        )
        .join('')}</table>`,
    );
    text.push(rows.map((r) => `${str(r.label)}: ${str(r.value)}`).join('\n'));
  }
  for (const sec of Array.isArray(d.sections) ? d.sections : []) {
    const body = sec ? str(sec.body).trim() : '';
    const strong = sec ? str(sec.strong).trim() : '';
    if (!sec || (!body && !strong)) continue;
    const head = str(sec.title)
      ? `<p style="margin:24px 0 4px;font-weight:600">${escapeHtml(str(sec.title))}</p>`
      : '';
    const inner = [
      body ? multiline(str(sec.body)) : '',
      strong ? `<strong>${multiline(strong)}</strong>` : '',
    ]
      .filter(Boolean)
      .join('<br>');
    html.push(
      `${head}<div style="margin:4px 0 16px;padding:12px 16px;border-left:4px solid ${brand.primary};background:#fafafa">${inner}</div>`,
    );
    const plain = [body ? str(sec.body) : '', strong].filter(Boolean).join('\n');
    text.push(str(sec.title) ? `${str(sec.title)}\n${plain}` : plain);
  }
  if (link) {
    html.push(button(cta, escapeHtml(str(d.cta) || link), brand.primary));
    text.push(str(d.cta) ? `${str(d.cta)}: ${link}` : link);
  }
  if (str(d.note).trim()) {
    html.push(`<p style="color:#71717a;font-size:12px">${multiline(str(d.note))}</p>`);
    text.push(str(d.note));
  }
  return { html, text };
}
