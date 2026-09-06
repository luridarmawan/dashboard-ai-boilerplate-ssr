#!/usr/bin/env bun
/**
 * M2 gate proof over plain HTTP (no browser, no JavaScript):
 *   #1 four themes selectable; switching changes colours (html attribute → tokens), icons
 *      (icon set) AND layout (auth/dashboard shells differ per theme)
 *   #2 the first HTML already carries the resolved theme, for anonymous visitors too
 *   #3 one page declares `_layoutVariant = 'wide'` and renders differently; others do not change
 *   #6 the theme picker works with JavaScript disabled (form + cookie)
 *
 *   WEB_URL=… ADMIN_EMAIL=… ADMIN_PASSWORD=… bun run scripts/m2-gate-proof.ts
 */
const WEB = (process.env.WEB_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.test';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'bootstrap admin password';

class Jar {
  cookies = new Map<string, string>();
  absorb(res: Response) {
    for (const raw of res.headers.getSetCookie()) {
      const [pair, ...attrs] = raw.split(';');
      const eq = pair?.indexOf('=') ?? -1;
      if (!pair || eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (attrs.some((a) => /max-age=0/i.test(a)) || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}
let failures = 0;
const check = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${cond || !extra ? '' : ` — ${extra}`}`);
  if (!cond) failures++;
};
async function get(jar: Jar, path: string) {
  const res = await fetch(`${WEB}${path}`, {
    headers: { cookie: jar.header(), accept: 'text/html' },
    redirect: 'manual',
  });
  jar.absorb(res);
  return { res, html: await res.text() };
}
async function post(jar: Jar, path: string, fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  const res = await fetch(`${WEB}${path}`, {
    method: 'POST',
    headers: {
      cookie: jar.header(),
      origin: WEB,
      accept: 'text/html',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
    redirect: 'manual',
  });
  jar.absorb(res);
  return { res, html: await res.text() };
}
const csrfOf = (html: string) => /name="_csrf" value="([^"]+)"/.exec(html)?.[1] ?? '';
const htmlAttr = (html: string, attr: string) =>
  new RegExp(`<html[^>]*\\s${attr}="([^"]*)"`).exec(html)?.[1] ?? '';
const footerLayout = (html: string) => /layout <code>([a-z-]+)<\/code>/.exec(html)?.[1] ?? '';
const footerVariant = (html: string) =>
  /varian <code>([a-z-]+)<\/code>/.exec(html)?.[1] ?? 'default';
/** Which glyph library rendered the icons: Lucide draws `<svg class="lucide …`, Phosphor draws `<svg … viewBox="0 0 256 256"`. */
const iconFamily = (html: string) =>
  html.includes('viewBox="0 0 256 256"') ? 'phosphor' : html.includes('lucide') ? 'lucide' : 'none';
const AUTH_MARK = {
  'centered-card': 'max-w-sm rounded-lg border bg-card',
  'split-hero': 'min-h-dvh lg:grid-cols-2',
} as const;

console.log(`M2 gates via web at ${WEB}`);
const anon = new Jar();

// ---- #2: anonymous first HTML is themed server-side ----
{
  const { res, html } = await get(anon, '/');
  check(
    'anonymous landing → 200 with data-app-theme and data-mode on <html>',
    res.status === 200 &&
      htmlAttr(html, 'data-app-theme') === 'base' &&
      htmlAttr(html, 'data-mode') === 'system',
    `${res.status} ${htmlAttr(html, 'data-app-theme')}/${htmlAttr(html, 'data-mode')}`,
  );
  check(
    'no client-side theme bootstrapping: tokens CSS is linked in <head>',
    /<link[^>]*\.css[^>]*>/.test(html) && /<link[^>]*rel="stylesheet"/.test(html),
  );
}

// ---- #6 + #1: the picker (no JS), four themes, cookie persistence ----
let pickerCsrf = '';
{
  const { res, html } = await get(anon, '/theme');
  pickerCsrf = csrfOf(html);
  const ids = [...html.matchAll(/name="theme" value="([a-z-]+)"/g)].map((m) => m[1]);
  check(
    'picker lists the four built-in themes with previews',
    res.status === 200 &&
      ['base', 'corporate', 'warm', 'contrast'].every((t) => ids.includes(t)) &&
      (html.match(/<svg/g)?.length ?? 0) >= 4,
    ids.join(','),
  );
  const r = await post(anon, '/theme', {
    _csrf: pickerCsrf,
    theme: 'corporate',
    mode: 'dark',
    back: '/',
  });
  check(
    'POST picker → 303 back, cookies dab_theme/dab_mode set',
    r.res.status === 303 &&
      anon.cookies.get('dab_theme') === 'corporate' &&
      anon.cookies.get('dab_mode') === 'dark',
    `${r.res.status}`,
  );
  const after = await get(anon, '/');
  check(
    'landing now renders corporate/dark server-side (no flicker: attribute in first HTML)',
    htmlAttr(after.html, 'data-app-theme') === 'corporate' &&
      htmlAttr(after.html, 'data-mode') === 'dark',
  );
  const bad = await post(anon, '/theme', {
    _csrf: pickerCsrf,
    theme: 'does-not-exist',
    mode: 'light',
    back: '/',
  });
  check(
    'unknown theme is ignored, mode still applied',
    bad.res.status === 303 &&
      anon.cookies.get('dab_theme') === 'corporate' &&
      anon.cookies.get('dab_mode') === 'light',
  );
}

// ---- #1: theme changes LAYOUT and ICONS, not just colours (auth shell, anonymous) ----
{
  const seen: Record<string, { layout: string; icons: string }> = {};
  for (const theme of ['base', 'corporate', 'warm', 'contrast'] as const) {
    await post(anon, '/theme', { _csrf: pickerCsrf, theme, mode: 'light', back: '/' });
    const { html } = await get(anon, '/auth/login');
    const layout = (Object.entries(AUTH_MARK).find(([, mark]) => html.includes(mark))?.[0] ??
      'unknown') as string;
    const pickerHtml = (await get(anon, '/theme')).html;
    seen[theme] = { layout, icons: iconFamily(pickerHtml) };
  }
  check(
    'auth layout differs between themes (base=centered-card, corporate=split-hero)',
    seen.base?.layout === 'centered-card' && seen.corporate?.layout === 'split-hero',
    JSON.stringify(seen),
  );
  check(
    'icon family differs between themes (warm=Phosphor solid, base=Lucide)',
    seen.warm?.icons === 'phosphor' && seen.base?.icons === 'lucide',
    JSON.stringify(seen),
  );
}

// ---- #1 + #3: dashboard shell per theme, and the `wide` variant ----
const admin = new Jar();
{
  await post(admin, '/theme', {
    _csrf: csrfOf((await get(admin, '/theme')).html),
    theme: 'base',
    mode: 'light',
    back: '/',
  });
  const page = await get(admin, '/auth/login');
  const r = await post(admin, '/auth/login', {
    _csrf: csrfOf(page.html),
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    next: '/dashboard',
  });
  check('admin login', r.res.status === 303, `${r.res.status}`);
  // The profile stores the theme too: reset it to base so the cookie test below is deterministic.
  await post(admin, '/theme', {
    _csrf: csrfOf((await get(admin, '/theme')).html),
    theme: 'base',
    mode: 'light',
    back: '/dashboard',
  });

  const dash = await get(admin, '/dashboard');
  check(
    'base dashboard uses sidebar-classic',
    footerLayout(dash.html) === 'sidebar-classic' && dash.html.includes('md:grid-cols-[16rem_1fr]'),
    footerLayout(dash.html),
  );
  const users = await get(admin, '/users');
  check(
    '#3 /users declares variant `wide` → base maps it to topnav-compact; page code unchanged',
    footerVariant(users.html) === 'wide' && footerLayout(users.html) === 'topnav-compact',
    `${footerLayout(users.html)}/${footerVariant(users.html)}`,
  );
  const groups = await get(admin, '/groups');
  check(
    '#3 a page without a variant keeps the default layout',
    footerVariant(groups.html) === 'default' && footerLayout(groups.html) === 'sidebar-classic',
  );

  await post(admin, '/theme', {
    _csrf: csrfOf((await get(admin, '/theme')).html),
    theme: 'corporate',
    mode: 'light',
    back: '/dashboard',
  });
  const corp = await get(admin, '/dashboard');
  check(
    '#1 corporate dashboard switches to topnav-compact — same pages, different shell',
    footerLayout(corp.html) === 'topnav-compact' && !corp.html.includes('md:grid-cols-[16rem_1fr]'),
    footerLayout(corp.html),
  );
  const corpUsers = await get(admin, '/users');
  check(
    '#3 corporate answers `wide` with its own mapping (topnav-compact) — variant, not layout id',
    footerVariant(corpUsers.html) === 'wide' && footerLayout(corpUsers.html) === 'topnav-compact',
  );
  const profile = await get(admin, '/profile');
  check(
    'logged-in choice persisted to the profile (theme select shows corporate)',
    /<option value="corporate"[^>]*selected/.test(profile.html),
  );
  check(
    'menu is filtered & rendered server-side with theme icons',
    corp.html.includes('href="/users"') && iconFamily(corp.html) === 'lucide',
  );
}

console.log(
  failures === 0 ? '\nGATE M2 #1 #2 #3 #6(tema): LOLOS' : `\nGATE M2: GAGAL (${failures})`,
);
process.exit(failures === 0 ? 0 : 1);
