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

export type TemplateId =
  | 'verify-email'
  | 'reset-password'
  | 'set-password'
  | 'invite'
  | 'invite-existing'
  | 'contact';

type Dict = Record<string, string>;
const T: Record<'id' | 'en', Dict> = {
  id: {
    hello: 'Halo {name},',
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
    ignore: 'Jika Anda tidak meminta ini, abaikan email ini.',
    footer: 'Email ini dikirim oleh {app}.',
    'link.fallback': 'Bila tombol tidak berfungsi, salin tautan ini ke peramban:',
  },
  en: {
    hello: 'Hello {name},',
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
    ignore: 'If you did not request this, you can ignore this email.',
    footer: 'This email was sent by {app}.',
    'link.fallback': 'If the button does not work, paste this link into your browser:',
  },
};

function tr(locale: string, key: string, params: Record<string, unknown> = {}): string {
  const dict = T[locale === 'en' ? 'en' : 'id'];
  const s = dict[key] ?? T.id[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (m, k: string) =>
    k in params ? escapeHtml(String(params[k])) : m,
  );
}
function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

function shell(brand: Brand, locale: string, title: string, bodyHtml: string): string {
  const logo = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.appName)}" height="32" style="height:32px">`
    : `<strong style="font-size:18px;color:${brand.primary}">${escapeHtml(brand.appName)}</strong>`;
  return `<!doctype html><html lang="${locale}"><body style="margin:0;background:#f4f4f5;font-family:system-ui,Segoe UI,Roboto,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden">
<tr><td style="padding:24px 32px;border-bottom:4px solid ${brand.primary}">${logo}</td></tr>
<tr><td style="padding:32px"><h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(title)}</h1>${bodyHtml}</td></tr>
<tr><td style="padding:16px 32px;background:#fafafa;color:#71717a;font-size:12px">${tr(locale, 'footer', { app: brand.appName })}</td></tr>
</table></td></tr></table></body></html>`;
}
const button = (href: string, label: string, color: string) =>
  `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${label}</a></p>`;
const fallback = (locale: string, href: string) =>
  `<p style="color:#71717a;font-size:12px">${tr(locale, 'link.fallback')}<br><a href="${escapeHtml(href)}" style="color:#71717a">${escapeHtml(href)}</a></p>`;

export function renderTemplate(
  id: TemplateId,
  locale: string,
  data: Record<string, unknown>,
  brand: Brand,
): Rendered {
  const app = brand.appName;
  const name = String(data.name ?? '');
  const link = String(data.link ?? '');
  switch (id) {
    case 'verify-email': {
      const subject = tr(locale, 'verify.subject', { app });
      const body = `<p>${tr(locale, 'hello', { name })}</p><p>${tr(locale, 'verify.body')}</p>${button(link, tr(locale, 'verify.cta'), brand.primary)}${fallback(locale, link)}<p style="color:#71717a">${tr(locale, 'ignore')}</p>`;
      return {
        subject,
        html: shell(brand, locale, subject, body),
        text: `${tr(locale, 'verify.body')}\n\n${link}\n\n${tr(locale, 'ignore')}`,
      };
    }
    case 'reset-password': {
      const subject = tr(locale, 'reset.subject', { app });
      const body = `<p>${tr(locale, 'hello', { name })}</p><p>${tr(locale, 'reset.body')}</p>${button(link, tr(locale, 'reset.cta'), brand.primary)}${fallback(locale, link)}<p style="color:#71717a">${tr(locale, 'ignore')}</p>`;
      return {
        subject,
        html: shell(brand, locale, subject, body),
        text: `${tr(locale, 'reset.body')}\n\n${link}`,
      };
    }
    case 'set-password': {
      const subject = tr(locale, 'set.subject', { app });
      const body = `<p>${tr(locale, 'hello', { name })}</p><p>${tr(locale, 'set.body')}</p>${button(link, tr(locale, 'set.cta'), brand.primary)}${fallback(locale, link)}`;
      return {
        subject,
        html: shell(brand, locale, subject, body),
        text: `${tr(locale, 'set.body')}\n\n${link}`,
      };
    }
    case 'invite': {
      const subject = tr(locale, 'invite.subject', { app, tenant: String(data.tenant ?? '') });
      const hours =
        data.hours === undefined
          ? ''
          : `<p>${tr(locale, 'invite.expires', { hours: String(data.hours) })}</p>`;
      const body = `<p>${tr(locale, 'hello', { name })}</p><p>${tr(locale, 'invite.body', { inviter: String(data.inviter ?? ''), tenant: String(data.tenant ?? '') })}</p>${hours}${button(link, tr(locale, 'invite.cta'), brand.primary)}${fallback(locale, link)}`;
      return {
        subject,
        html: shell(brand, locale, subject, body),
        text: `${tr(locale, 'invite.body', { inviter: String(data.inviter ?? ''), tenant: String(data.tenant ?? '') })}\n\n${link}`,
      };
    }
    case 'invite-existing': {
      const vars = { inviter: String(data.inviter ?? ''), tenant: String(data.tenant ?? '') };
      const subject = tr(locale, 'invite_existing.subject', { app });
      const body = `<p>${tr(locale, 'hello', { name })}</p><p>${tr(locale, 'invite_existing.body', vars)}</p>${button(link, tr(locale, 'invite_existing.cta'), brand.primary)}${fallback(locale, link)}`;
      return {
        subject,
        html: shell(brand, locale, subject, body),
        text: `${tr(locale, 'invite_existing.body', vars)}\n\n${link}`,
      };
    }
    case 'contact': {
      const subject = tr(locale, 'contact.subject', { app, name });
      const msg = escapeHtml(String(data.message ?? '')).replace(/\n/g, '<br>');
      const body = `<p>${tr(locale, 'contact.body')}</p><blockquote style="margin:16px 0;padding:12px 16px;border-left:4px solid ${brand.primary};background:#fafafa">${msg}</blockquote><p><strong>${tr(locale, 'contact.reply')}:</strong> ${escapeHtml(name)} &lt;${escapeHtml(String(data.email ?? ''))}&gt;</p>`;
      return {
        subject,
        html: shell(brand, locale, subject, body),
        text: `${tr(locale, 'contact.body')}\n\n${String(data.message ?? '')}\n\n${tr(locale, 'contact.reply')}: ${name} <${String(data.email ?? '')}>`,
      };
    }
  }
}
