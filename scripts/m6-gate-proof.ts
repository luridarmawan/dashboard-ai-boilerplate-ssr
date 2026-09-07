#!/usr/bin/env bun
/**
 * M6 gate #1 / PRD §8 #11 over plain HTTP (no browser, no JavaScript): a module produced by
 * `bun modgen` works end to end without any core edit — table migrated, menu entry, permission
 * enforced, CRUD through list/new/edit pages, i18n in both locales, settings section, dashboard
 * widget, public page + sitemap, an event hook that fires and a scheduled job that is registered.
 *
 *   WEB_URL=… API_LOG=.proof-logs/m1-api.log ADMIN_EMAIL=… ADMIN_PASSWORD=… \
 *   MODULE_NS=ciprobe MODULE_PLURAL=widgets bun run scripts/m6-gate-proof.ts
 */
import { readFileSync } from 'node:fs';

const WEB = (process.env.WEB_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.test';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'bootstrap admin password';
const NS = process.env.MODULE_NS ?? 'ciprobe';
const PLURAL = process.env.MODULE_PLURAL ?? 'widgets';
const RES = process.env.MODULE_RES ?? 'widget';
const API_LOG = process.env.API_LOG ?? '.proof-logs/m1-api.log';
const BASE = `/m/${NS}/${PLURAL}`;
const run = Date.now();

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
async function get(jar: Jar, path: string, accept = 'text/html') {
  const res = await fetch(`${WEB}${path}`, {
    headers: { cookie: jar.header(), accept },
    redirect: 'manual',
  });
  jar.absorb(res);
  return { res, html: await res.text() };
}
async function post(jar: Jar, path: string, fields: Record<string, string | string[]>) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields))
    for (const item of Array.isArray(v) ? v : [v]) body.append(k, item);
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
const location = (res: Response) => res.headers.get('location') ?? '';
const groupIdFor = (html: string, name: string) =>
  new RegExp(
    `value="([0-9a-f-]{36})"[^>]*>[^<]*${name}|${name}[^<]*<[^>]*value="([0-9a-f-]{36})"`,
  ).exec(html)?.[1] ??
  new RegExp(`name="groupIds" value="([0-9a-f-]{36})"[\\s\\S]{0,200}?${name}`).exec(html)?.[1] ??
  '';
async function login(jar: Jar, email: string, password: string) {
  const page = await get(jar, '/auth/login');
  const r = await post(jar, '/auth/login', {
    _csrf: csrfOf(page.html),
    email,
    password,
    next: '/dashboard',
  });
  return r.res.status;
}
const logHas = (needle: string) => {
  try {
    return readFileSync(API_LOG, 'utf8').includes(needle);
  } catch {
    return false;
  }
};
async function waitLog(needle: string, ms = 4000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (logHas(needle)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return logHas(needle);
}

console.log(`M6 gate #1 via web at ${WEB} — module "${NS}" (${BASE})`);
const admin = new Jar();
const anon = new Jar();
check('admin login', (await login(admin, ADMIN_EMAIL, ADMIN_PASSWORD)) === 303);

// ---- menu, widget, settings section, job registration ----
{
  const dash = await get(admin, '/dashboard');
  check(
    `menu entry ${BASE} is in the dashboard shell (extension point 4)`,
    dash.html.includes(`href="${BASE}"`),
  );
  check(
    `dashboard widget widget-${NS} rendered server-side (extension point 11)`,
    dash.html.includes(`data-testid="widget-${NS}"`),
  );
  const settings = await get(admin, '/settings?scope=global');
  check(
    `settings form has the module section (${NS}.page_size) (extension point 6)`,
    settings.html.includes(`name="${NS}.page_size"`),
  );
  check(
    `scheduled job ${NS}.heartbeat registered at boot (extension point 12)`,
    logHas(`${NS}.heartbeat`),
    `not in ${API_LOG}`,
  );
  const toolsRes = await fetch(`${process.env.API_URL ?? 'http://127.0.0.1:3001'}/v1/tools`, {
    headers: { cookie: admin.header(), accept: 'application/json' },
  });
  const tools = ((await toolsRes.json()) as { data?: { name: string }[] }).data ?? [];
  check(
    `tool ${NS}.list_${PLURAL} registered and offered to the admin (extension point 8)`,
    tools.some((t) => t.name === `${NS}.list_${PLURAL}`),
    `${toolsRes.status} ${tools.map((t) => t.name).join(',')}`,
  );
}

// ---- list page: i18n (id → en), seed row ----
{
  const list = await get(admin, BASE);
  check(
    'list page → 200 with the Indonesian labels (i18n, extension point 7)',
    list.res.status === 200 && list.html.includes(`${RES[0]?.toUpperCase()}${RES.slice(1)} baru`),
    `${list.res.status}`,
  );
  check('seeded sample row is listed (seed.ts, idempotent)', list.html.includes(`Contoh ${RES}`));
  await post(admin, '/lang', {
    _csrf: csrfOf((await get(admin, '/lang')).html),
    lang: 'en',
    back: BASE,
  });
  const en = await get(admin, BASE);
  check(
    'same page in English after /lang (no JS)',
    en.html.includes(`New ${RES[0]?.toUpperCase()}${RES.slice(1)}`),
  );
  await post(admin, '/lang', {
    _csrf: csrfOf((await get(admin, '/lang')).html),
    lang: 'id',
    back: BASE,
  });
}

// ---- CRUD through the generated forms ----
let id = '';
{
  const page = await get(admin, `${BASE}/new`);
  check(
    'new form renders (FormBuilder from the shared schema)',
    page.res.status === 200 &&
      page.html.includes('name="name"') &&
      page.html.includes('name="kind"'),
  );
  const bad = await post(admin, `${BASE}/new`, { _csrf: csrfOf(page.html), name: '', qty: '1' });
  check(
    'validation: empty required field → 422 with the field marked',
    bad.res.status === 422 && bad.html.includes('Periksa isian'),
    `${bad.res.status}`,
  );
  const r = await post(admin, `${BASE}/new`, {
    _csrf: csrfOf(page.html),
    name: `Proof ${run}`,
    qty: '7',
    active: 'on',
    notes: 'dibuat oleh bukti M6',
    kind: 'b',
    due: '2026-12-31',
  });
  id =
    new RegExp(`${BASE.replace(/\//g, '\\/')}\\/([0-9a-f-]{36})`).exec(location(r.res))?.[1] ?? '';
  check(
    'create → 303 to the new row',
    r.res.status === 303 && id.length === 36,
    `${r.res.status} ${location(r.res)} ${r.html.slice(0, 200)}`,
  );
  const detail = await get(admin, `${BASE}/${id}?saved=1`);
  const tag = (name: string) =>
    new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(detail.html)?.[0] ?? `(no input ${name})`;
  const api = await fetch(
    `${process.env.API_URL ?? 'http://127.0.0.1:3001'}/v1/m/${NS}/${PLURAL}/${id}`,
    {
      headers: { cookie: admin.header(), accept: 'application/json' },
    },
  );
  const apiRow = ((await api.json()) as { data?: Record<string, unknown> }).data ?? {};
  check(
    'edit page → 200',
    detail.res.status === 200,
    `${detail.res.status} ${detail.html.slice(0, 300)}`,
  );
  check(
    'API returns the date field as YYYY-MM-DD',
    apiRow.due === '2026-12-31',
    JSON.stringify(apiRow),
  );
  check(
    'edit page shows the saved name in the form',
    tag('name').includes(`Proof ${run}`),
    tag('name'),
  );
  check(
    'edit page shows the saved date in the form',
    tag('due').includes('2026-12-31'),
    tag('due'),
  );
  check(
    'edit page shows the saved notice',
    detail.html.includes('Tersimpan'),
    detail.html.slice(0, 200),
  );
  const save = await post(admin, `${BASE}/${id}?/save`, {
    _csrf: csrfOf(detail.html),
    name: `Proof ${run} v2`,
    qty: '8',
    kind: 'c',
    due: '2026-12-31',
  });
  check(
    'edit → 200 saved notice',
    save.res.status === 200 && save.html.includes('Tersimpan'),
    `${save.res.status}`,
  );
  const list = await get(admin, `${BASE}?q=proof+${run}`);
  check('list search finds the edited row', list.html.includes(`Proof ${run} v2`));
  const del = await post(admin, `${BASE}/${id}?/delete`, { _csrf: csrfOf(detail.html) });
  check(
    'delete → 303 back to the list',
    del.res.status === 303 && location(del.res).startsWith(BASE),
    `${del.res.status}`,
  );
  const gone = await get(admin, `${BASE}/${id}`);
  check('deleted row → 404 page', gone.res.status === 404, `${gone.res.status}`);
}

// ---- permission enforced + hook fires on user creation ----
{
  const page = await get(admin, '/users/new');
  const groupId = groupIdFor(page.html, 'Regular User');
  const email = `m6-${run}@example.test`;
  const password = 'an m6 member password 123';
  const r = await post(admin, '/users/new', {
    _csrf: csrfOf(page.html),
    name: 'M6 Member',
    email,
    password,
    groupIds: groupId ? [groupId] : [],
  });
  check('admin creates a member', r.res.status === 303, `${r.res.status}`);
  check(
    `hook ${NS} heard user.created (extension point 9, logged by the module)`,
    await waitLog(`${NS}: user created`),
    `not in ${API_LOG}`,
  );
  const member = new Jar();
  check('member logs in', (await login(member, email, password)) === 303);
  const dash = await get(member, '/dashboard');
  check(
    `member without ${NS}.${RES}.read: no menu entry, no widget`,
    !dash.html.includes(`href="${BASE}"`) && !dash.html.includes(`widget-${NS}`),
  );
  const denied = await get(member, BASE);
  check(
    'member is refused the module page (403 from the API surfaces as an error page)',
    denied.res.status === 403,
    `${denied.res.status}`,
  );
  const api = await fetch(`${process.env.API_URL ?? 'http://127.0.0.1:3001'}/v1/m/${NS}/${PLURAL}`);
  check('anonymous API call → 401', api.status === 401, `${api.status}`);
  const memberTools = await fetch(`${process.env.API_URL ?? 'http://127.0.0.1:3001'}/v1/tools`, {
    headers: { cookie: member.header(), accept: 'application/json' },
  });
  const visible = ((await memberTools.json()) as { data?: { name: string }[] }).data ?? [];
  check(
    `member without ${NS}.${RES}.read: tool ${NS}.list_${PLURAL} is not offered (I-3)`,
    memberTools.status === 200 && !visible.some((t) => t.name === `${NS}.list_${PLURAL}`),
    `${memberTools.status} ${visible.map((t) => t.name).join(',')}`,
  );
}

// ---- public page (extension point 13) + sitemap ----
{
  const pub = await get(anon, `/${NS}`);
  check(
    `public page /${NS} → 200 for anonymous, SSR`,
    pub.res.status === 200 && pub.html.includes(`data-testid="public-${NS}"`),
    `${pub.res.status}`,
  );
  const sm = await get(anon, '/sitemap.xml', 'application/xml');
  check(`sitemap.xml lists /${NS}`, sm.html.includes(`/${NS}<`));
}

if (failures) {
  console.log(`GATE M6 #1: GAGAL (${failures})`);
  process.exit(1);
}
console.log('GATE M6 #1: LOLOS — modul hasil modgen berfungsi penuh tanpa mengubah core');
