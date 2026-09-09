#!/usr/bin/env bun
/**
 * M2 gate proof over plain HTTP (no browser, no JavaScript):
 *   #1 four themes selectable; switching changes colours (html attribute → tokens), icons
 *      (icon set) AND layout (auth/dashboard shells differ per theme)
 *   #2 the first HTML already carries the resolved theme, for anonymous visitors too
 *   #3 one page declares `_layoutVariant = 'wide'`; the THEME decides which layout answers it, so
 *      the same page renders in a different shell per theme while its code never changes
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
const footerLayout = (html: string) => /layout <code>([a-z.-]+)<\/code>/.exec(html)?.[1] ?? '';
const footerVariant = (html: string) =>
  /varian <code>([a-z.-]+)<\/code>/.exec(html)?.[1] ?? 'default';
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
    '#3 /users declares variant `wide`; base answers it with sidebar-classic — one shell per theme',
    footerVariant(users.html) === 'wide' && footerLayout(users.html) === 'sidebar-classic',
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
    '#3 the SAME page answers `wide` with topnav-compact under corporate — variant, not layout id',
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

// ---- #6 (language) + K-2/K-7: server-side language, picker without JS ----
{
  const fresh = new Jar();
  const idHtml = (await get(fresh, '/')).html;
  check(
    'K-2 default language id on <html lang> for a visitor with no preference',
    htmlAttr(idHtml, 'lang') === 'id' && idHtml.includes('Masuk'),
  );
  const enRes = await fetch(`${WEB}/`, {
    headers: { accept: 'text/html', 'accept-language': 'en-US,en;q=0.9' },
  });
  const enHtml = await enRes.text();
  check(
    'K-2 Accept-Language: en → first HTML already in English (lang="en", "Sign in")',
    htmlAttr(enHtml, 'lang') === 'en' && enHtml.includes('Sign in'),
  );
  const picker = await get(fresh, '/lang');
  check(
    'language picker lists id and en',
    picker.res.status === 200 &&
      picker.html.includes('name="lang" value="id"') &&
      picker.html.includes('name="lang" value="en"'),
  );
  const r = await post(fresh, '/lang', {
    _csrf: csrfOf(picker.html),
    lang: 'en',
    back: '/auth/login',
  });
  check(
    '#6 POST /lang (no JS) → 303 back, dab_lang cookie',
    r.res.status === 303 && fresh.cookies.get('dab_lang') === 'en',
  );
  const login = await get(fresh, '/auth/login');
  check(
    'cookie wins over header default: login page in English',
    htmlAttr(login.html, 'lang') === 'en' &&
      login.html.includes('Sign in') &&
      !login.html.includes('Kata sandi'),
  );
  // Logged in: the menu (SSR) follows the locale, and the choice is persisted to the profile.
  await post(admin, '/lang', {
    _csrf: csrfOf((await get(admin, '/lang')).html),
    lang: 'en',
    back: '/dashboard',
  });
  const dash = await get(admin, '/dashboard');
  check(
    'dashboard menu rendered in English server-side ("Users", "Groups & permissions")',
    dash.html.includes('>Users<') && dash.html.includes('Groups &amp; permissions'),
  );
  const profile = await get(admin, '/profile');
  check(
    'profile locale persisted (select shows en)',
    /<option value="en"[^>]*selected/.test(profile.html),
  );
  await post(admin, '/lang', {
    _csrf: csrfOf((await get(admin, '/lang')).html),
    lang: 'id',
    back: '/dashboard',
  });
  const back = await get(admin, '/dashboard');
  check('switching back to id restores the Indonesian menu', back.html.includes('>Pengguna<'));
  // K-9: direction is decided on the server too — ltr for id/en, rtl on request (preview cookie).
  check('K-9 <html dir="ltr"> for id', htmlAttr(back.html, 'dir') === 'ltr');
  await post(admin, '/lang', {
    _csrf: csrfOf((await get(admin, '/lang')).html),
    lang: 'id',
    rtl: '1',
    back: '/dashboard',
  });
  const rtl = await get(admin, '/dashboard');
  check(
    'K-9 RTL preview → first HTML has dir="rtl" (shell rendered server-side, no flip on the client)',
    htmlAttr(rtl.html, 'dir') === 'rtl' && rtl.html.includes('>Pengguna<'),
  );
  check(
    'K-9 dashboard shell uses logical CSS only (no ml-/mr-/pl-/pr-/left-/right-/text-left/text-right)',
    !/class="[^"]*\b(ml|mr|pl|pr|left|right)-[0-9a-z]|class="[^"]*\btext-(left|right)\b/.test(
      rtl.html,
    ),
  );
  await post(admin, '/lang', {
    _csrf: csrfOf((await get(admin, '/lang')).html),
    lang: 'id',
    back: '/dashboard',
  });
  check(
    'K-9 unticking the preview restores dir="ltr"',
    htmlAttr((await get(admin, '/dashboard')).html, 'dir') === 'ltr',
  );
}

// ---- G-19: dashboard widgets are permission-filtered on the server ----
{
  await post(admin, '/theme', {
    _csrf: csrfOf((await get(admin, '/theme')).html),
    theme: 'base',
    mode: 'light',
    back: '/dashboard',
  });
  const dash = await get(admin, '/dashboard');
  check(
    'superadmin sees the Dummy module widget on the dashboard (SSR)',
    dash.html.includes('data-testid="widget-dummy"'),
  );
  // A brand-new member has no dummy.note.read → the widget is absent from the HTML, not hidden by CSS.
  const member = new Jar();
  const email = `w-${Date.now()}@example.test`;
  const reg = await get(member, '/auth/register');
  const r = await post(member, '/auth/register', {
    _csrf: csrfOf(reg.html),
    name: 'Widget Less',
    email,
    password: 'a widget less password 1',
  });
  check('member registers', r.res.status === 303, `${r.res.status}`);
  const mdash = await get(member, '/dashboard');
  check(
    'member without dummy.note.read gets no widget markup at all',
    !mdash.html.includes('widget-dummy') && !mdash.html.includes('NotesCount'),
  );
  const ex = await get(admin, '/examples/list');
  check(
    'L-19 example list page renders the DataTable with paging (wide variant)',
    ex.res.status === 200 &&
      ex.html.includes('Contoh daftar produk') &&
      footerVariant(ex.html) === 'wide',
  );
  const err = await get(admin, '/examples/errors?code=403');
  check(
    'L-19 403 inside the shell: status 403 and the menu still rendered',
    err.res.status === 403 && err.html.includes('href="/users"'),
  );
}

// ---- #5: a layout registered from OUTSIDE core is used, without changing any page ----
{
  const picker = await get(admin, '/theme');
  check(
    '#5 the picker lists the module theme dummy.ocean (extension point 14)',
    picker.html.includes('name="theme" value="dummy.ocean"'),
  );
  await post(admin, '/theme', {
    _csrf: csrfOf(picker.html),
    theme: 'dummy.ocean',
    mode: 'light',
    back: '/dashboard',
  });
  const dash = await get(admin, '/dashboard');
  check(
    '#5 dashboard renders the module layout dummy.two-column (extension point 15)',
    footerLayout(dash.html) === 'dummy.two-column' &&
      dash.html.includes('data-layout="dummy.two-column"') &&
      htmlAttr(dash.html, 'data-app-theme') === 'dummy.ocean',
    `${footerLayout(dash.html)}`,
  );
  check(
    '#5 the same pages: menu, users link and content region are all there',
    dash.html.includes('href="/users"') && dash.html.includes('id="content"'),
  );
  const users = await get(admin, '/users');
  check(
    '#5 /users (variant `wide`) stays on the module layout — one shell per theme, module themes too',
    footerVariant(users.html) === 'wide' && footerLayout(users.html) === 'dummy.two-column',
    `${footerLayout(users.html)}/${footerVariant(users.html)}`,
  );
  // Mixing is free in the other direction too: the module theme's dashboard is a MODULE layout
  // while its auth shell is a CORE one. Checked anonymously — /auth/login redirects when logged in.
  await post(anon, '/theme', { _csrf: pickerCsrf, theme: 'dummy.ocean', mode: 'light', back: '/' });
  const oceanLogin = await get(anon, '/auth/login');
  check(
    '#5 module theme mixes registries: module layout for dashboard, core centered-card for auth',
    oceanLogin.html.includes(AUTH_MARK['centered-card']),
  );
  check(
    '#5 icons come from the module icon set dummy.rounded-24 (Lucide, stroke 2.25)',
    /stroke-width="2.25"/.test(dash.html),
  );
  // back to base for whatever runs next
  await post(admin, '/theme', {
    _csrf: csrfOf((await get(admin, '/theme')).html),
    theme: 'base',
    mode: 'light',
    back: '/dashboard',
  });
}

console.log(
  failures === 0
    ? '\nGATE M2 #1 #2 #3 #5 #6 + G-19 + L-19: LOLOS'
    : `\nGATE M2: GAGAL (${failures})`,
);
process.exit(failures === 0 ? 0 : 1);
