#!/usr/bin/env bun
/**
 * M3 gate proof over plain HTTP (no browser, no JavaScript):
 *   #1 an admin changes settings, the default theme and the landing page from the UI — they apply
 *      on the very next request, without restart (E-5); the scale runner repeats this across replicas
 *   #3 a landing route that points to a DISABLED module falls back to a safe page, never a 404 on `/`
 *
 *   WEB_URL=… ADMIN_EMAIL=… ADMIN_PASSWORD=… bun run scripts/m3-gate-proof.ts
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
async function post(jar: Jar, path: string, fields: Record<string, string | string[]>) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields))
    for (const x of Array.isArray(v) ? v : [v]) body.append(k, x);
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

/** Save one settings section through the generated form: keys posted exactly as the form would. */
async function saveApp(
  jar: Jar,
  scope: 'tenant' | 'global',
  values: Record<string, string | string[]>,
) {
  const page = await get(jar, `/settings?scope=${scope}`);
  const keys = Object.keys(values);
  const r = await post(jar, '/settings?/save', {
    _csrf: csrfOf(page.html),
    _scope: scope,
    _section: 'app',
    _keys: keys,
    _lists: keys.filter((k) => k === 'app.allowed_themes'),
    ...values,
  });
  return r.res.status;
}

console.log(`M3 gates via web at ${WEB}`);
const admin = new Jar();
const anon = new Jar();
{
  const page = await get(admin, '/auth/login');
  const r = await post(admin, '/auth/login', {
    _csrf: csrfOf(page.html),
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    next: '/dashboard',
  });
  check('admin login', r.res.status === 303, `${r.res.status}`);
  const settings = await get(admin, '/settings?scope=global');
  check(
    'settings form is generated from the registry: app, security, mail, ai and the Dummy module section',
    settings.res.status === 200 &&
      ['id="app"', 'id="security"', 'id="mail"', 'id="ai"', 'id="dummy"'].every((m) =>
        settings.html.includes(m),
      ),
  );
  check(
    'secret fields never show a value, only whether they are set (E-4)',
    settings.html.includes('name="ai.key"') && !settings.html.includes('value="sk-'),
  );
  // reset to a known state
  await saveApp(admin, 'global', {
    'app.landing_route': '',
    'app.default_theme': '',
    'app.home_route': '',
    'app.allowed_themes': [],
  });
  await saveApp(admin, 'tenant', {
    'app.landing_route': '',
    'app.default_theme': '',
    'app.home_route': '',
    'app.allowed_themes': [],
  });
}

// ---- #1: landing route ----
{
  const before = await get(anon, '/');
  check(
    'default landing → 200 (the Example storefront when installed, else the built-in page)',
    before.res.status === 200 &&
      ['/example', null].includes(before.res.headers.get('x-landing-route')),
  );
  const bad = await saveApp(admin, 'global', { 'app.landing_route': '/m/ghost' });
  check(
    'route values are validated against the registry when saved (§4.7 rule 1) → form error, not a later 404',
    bad === 422 || bad === 200,
  );
  const okSave = await saveApp(admin, 'global', { 'app.landing_route': '/auth/login' });
  check('save app.landing_route=/auth/login → 303', okSave === 303, `${okSave}`);
  const after = await get(anon, '/');
  check(
    '#1 `/` now serves the login page server-side, URL unchanged, no redirect, no restart',
    after.res.status === 200 &&
      after.res.headers.get('x-landing-route') === '/auth/login' &&
      after.html.includes('name="password"'),
  );
  await saveApp(admin, 'global', { 'app.landing_route': '/hello-dummy' });
  const mod = await get(anon, '/');
  check(
    'landing can be a public module page (/hello-dummy, extension point 13)',
    mod.res.status === 200 &&
      mod.res.headers.get('x-landing-route') === '/hello-dummy' &&
      mod.html.includes('data-testid="public-module-page"'),
  );
}

// ---- #3: landing points to a module that gets disabled → safe fallback ----
{
  const modulesPage = await get(admin, '/modules');
  const off = await post(admin, '/modules?/toggle', {
    _csrf: csrfOf(modulesPage.html),
    module: 'Dummy',
    scope: 'global',
    state: 'off',
  });
  check('disable Dummy globally → 303', off.res.status === 303, `${off.res.status}`);
  const front = await get(anon, '/');
  check(
    '#3 `/` still answers 200 with a safe page (not 404, not the disabled module page)',
    front.res.status === 200 &&
      front.res.headers.get('x-landing-route') !== '/hello-dummy' &&
      !front.html.includes('data-testid="public-module-page"'),
  );
  const dash = await get(admin, '/dashboard');
  check(
    '#3 disabled module: its menu entry and widget are gone from the dashboard',
    !dash.html.includes('href="/m/dummy/notes"') && !dash.html.includes('widget-dummy'),
  );
  const picker = await get(anon, '/theme');
  check(
    '#3 disabled module: its theme is not offered (L-14)',
    !picker.html.includes('value="dummy.ocean"'),
  );
  const on = await post(admin, '/modules?/toggle', {
    _csrf: csrfOf((await get(admin, '/modules')).html),
    module: 'Dummy',
    scope: 'global',
    state: 'on',
  });
  check('re-enable Dummy → 303', on.res.status === 303);
  const restored = await get(anon, '/');
  check(
    'landing serves the module page again on the next request',
    restored.res.headers.get('x-landing-route') === '/hello-dummy',
  );
  await saveApp(admin, 'global', { 'app.landing_route': '' });
}

// ---- #1: default theme + allowlist + home route, all from the UI ----
{
  await saveApp(admin, 'global', { 'app.default_theme': 'corporate' });
  const fresh = new Jar();
  const home = await get(fresh, '/auth/login');
  check(
    '#1 default theme from configuration: an anonymous visitor now gets corporate on first paint',
    htmlAttr(home.html, 'data-app-theme') === 'corporate',
    htmlAttr(home.html, 'data-app-theme'),
  );
  await saveApp(admin, 'global', { 'app.allowed_themes': ['base', 'corporate'] });
  const picker = await get(fresh, '/theme');
  const ids = [...picker.html.matchAll(/name="theme" value="([a-z.-]+)"/g)].map((m) => m[1]);
  check(
    '#1 allowlist from configuration: the picker offers exactly base and corporate (L-11)',
    ids.sort().join(',') === 'base,corporate',
    ids.join(','),
  );
  await saveApp(admin, 'global', { 'app.home_route': '/profile' });
  const login = await get(new Jar(), '/auth/login');
  check(
    '#1 home route from configuration: the login form targets /profile',
    /name="next" value="\/profile"/.test(login.html),
  );
  // reset
  await saveApp(admin, 'global', {
    'app.default_theme': '',
    'app.allowed_themes': [],
    'app.home_route': '',
  });
  const back = await get(new Jar(), '/auth/login');
  check('reset applied immediately (base again)', htmlAttr(back.html, 'data-app-theme') === 'base');
}

console.log(failures === 0 ? '\nGATE M3 #1 #3: LOLOS' : `\nGATE M3: GAGAL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
