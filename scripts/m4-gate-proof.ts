#!/usr/bin/env bun
/**
 * M4 gate proof over plain HTTP (no browser, no JavaScript):
 *   #1 `/` serves the Example commercial landing, server-rendered, on a clean install
 *   #3 the contact form works without JavaScript, is stored, and its email lands in the outbox
 *   #4 Example disabled → the app stays whole and `/` falls back (F-6)
 *   + R-3/R-4: product detail from the module table, SEO meta + JSON-LD, sitemap.xml, robots.txt
 * (#2 Lighthouse runs in CI with Chrome — see .github/workflows/ci.yml.)
 */
const WEB = (process.env.WEB_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.test';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'bootstrap admin password';
/** Where /v1 lives: through Caddy it is the same origin; in the bare runner it is the API port. */
const API = (process.env.API_URL ?? WEB).replace(/\/$/, '');
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

console.log(`M4 gates via web at ${WEB}`);
const anon = new Jar();
const admin = new Jar();
{
  const page = await get(admin, '/auth/login');
  const r = await post(admin, '/auth/login', {
    _csrf: csrfOf(page.html),
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    next: '/dashboard',
  });
  check('admin login', r.res.status === 303, `${r.res.status}`);
  // make sure Example is enabled and the landing route is the default
  const modules = await get(admin, '/modules');
  await post(admin, '/modules?/toggle', {
    _csrf: csrfOf(modules.html),
    module: 'Example',
    scope: 'global',
    state: 'on',
  });
  const settings = await get(admin, '/settings?scope=global');
  await post(admin, '/settings?/save', {
    _csrf: csrfOf(settings.html),
    _scope: 'global',
    _section: 'app',
    _keys: ['app.landing_route'],
    'app.landing_route': '',
  });
  // the contact recipient, so the inquiry produces an outbox row (#3)
  const s2 = await get(admin, '/settings?scope=global');
  await post(admin, '/settings?/save', {
    _csrf: csrfOf(s2.html),
    _scope: 'global',
    _section: 'example',
    _keys: ['example.contact_email'],
    'example.contact_email': 'sales@example.test',
  });
}

// ---- #1: clean install → / is the commercial landing, SSR ----
{
  const { res, html } = await get(anon, '/');
  check(
    '#1 `/` → 200 and the Example landing is served (x-landing-route=/example)',
    res.status === 200 && res.headers.get('x-landing-route') === '/example',
    `${res.status} ${res.headers.get('x-landing-route')}`,
  );
  check(
    '#1 hero, features, products from the DB, testimonials, pricing, contact — all in the first HTML',
    [
      'data-testid="products"',
      'id="products"',
      'id="contact"',
      'Gayo Arabika',
      'Kata mereka',
      'Paket langganan',
    ].every((m) => html.includes(m)),
  );
  check(
    'R-4 SEO: title, description, canonical, Open Graph, JSON-LD without JavaScript',
    /<title>[^<]+<\/title>/.test(html) &&
      html.includes('name="description"') &&
      html.includes('rel="canonical"') &&
      html.includes('property="og:title"') &&
      html.includes('application/ld+json'),
  );
  check(
    'R-7: copy through i18n — English when asked',
    (
      await fetch(`${WEB}/`, { headers: { accept: 'text/html', 'accept-language': 'en' } }).then(
        (r) => r.text(),
      )
    ).includes('Featured products'),
  );
  const en = await fetch(`${WEB}/`, { headers: { accept: 'text/html', 'accept-language': 'en' } });
  void en;
  const p = await get(anon, '/product/gayo-arabika');
  check(
    'R-3 product detail /product/<slug> from the module table, with Product JSON-LD',
    p.res.status === 200 &&
      p.html.includes('data-testid="price"') &&
      p.html.includes('"@type":"Product"') &&
      p.html.includes('rel="canonical"'),
  );
  const missing = await get(anon, '/product/does-not-exist');
  check('unknown slug → 404 (not 500)', missing.res.status === 404, `${missing.res.status}`);
  const sm = await get(anon, '/sitemap.xml', 'application/xml');
  check(
    'F-7 sitemap.xml lists /example and product pages',
    sm.res.status === 200 &&
      sm.html.includes(`${WEB}/example`) &&
      sm.html.includes('/product/gayo-arabika'),
  );
  const rb = await get(anon, '/robots.txt', 'text/plain');
  check(
    'F-7 robots.txt with Sitemap line',
    rb.res.status === 200 && rb.html.includes('Sitemap: ') && rb.html.includes('User-agent'),
  );
}

// ---- #3: contact form without JavaScript → stored → outbox ----
{
  const landing = await get(anon, '/');
  const email = `visitor-${run}@example.test`;
  const r = await post(anon, '/example?/contact', {
    _csrf: csrfOf(landing.html),
    name: 'Visitor',
    email,
    message: 'Halo, saya ingin memesan 10 kg untuk kantor kami. Terima kasih.',
    website: '',
  });
  check(
    '#3 contact form POST (no JS) → 200 with confirmation',
    r.res.status === 200 && r.html.includes('data-testid="contact-sent"'),
    `${r.res.status}`,
  );
  const bot = await post(anon, '/example?/contact', {
    _csrf: csrfOf(landing.html),
    name: 'Bot',
    email: `bot-${run}@example.test`,
    message: 'buy cheap things now please click here',
    website: 'http://spam.example',
  });
  check(
    'honeypot: a filled hidden field is accepted silently and stored nowhere',
    bot.res.status === 200,
  );
  const inbox = await get(admin, '/m/example/inquiries');
  const direct = await fetch(`${API}/v1/m/example/products`, {
    headers: { accept: 'application/json' },
  });
  check(
    'public module API reachable anonymously (/v1/m/example/products)',
    direct.ok,
    `${direct.status} ${(await direct.text()).slice(0, 200)}`,
  );
  check(
    '#3 the inquiry is stored (dashboard shows it) and the bot one is not',
    inbox.html.includes(email) && !inbox.html.includes(`bot-${run}@example.test`),
  );
  // outbox row via the API through the same origin (GET, session cookie)
  const ob = await fetch(`${API}/v1/outbox?limit=20`, {
    headers: { cookie: admin.header(), accept: 'application/json' },
  });
  const rows = ob.ok
    ? ((await ob.json()) as { data: { template: string; to: string; status: string }[] }).data
    : [];
  check(
    '#3 the contact email is in the outbox (template contact → sales@example.test)',
    rows.some((x) => x.template === 'contact' && x.to === 'sales@example.test'),
    `${ob.status} ${rows.length} rows`,
  );
}

// ---- R-9: a SECOND public arrangement from the same module, and `/` may point at it ----
{
  const cat = await get(anon, '/catalog');
  check(
    'R-9 /catalog → 200, server-rendered from the same tables, arranged differently',
    cat.res.status === 200 &&
      cat.html.includes('data-testid="catalog-items"') &&
      cat.html.includes('Gayo Arabika') &&
      cat.html.includes('data-testid="catalog-filters"') &&
      // …and it is NOT the storefront: that page's sections are simply not rendered here.
      // (Marker must be MARKUP, not copy: the i18n catalogue itself ships in every page payload.)
      !cat.html.includes('id="products"'),
    `${cat.res.status}`,
  );
  check(
    'R-9 SEO of its own: title, canonical /catalog, ItemList JSON-LD',
    /<title>[^<]+<\/title>/.test(cat.html) &&
      cat.html.includes(`${WEB}/catalog`) &&
      cat.html.includes('"@type":"ItemList"'),
  );
  // The filter is the API's work, so it answers the same with JavaScript off (L-20 over L-22).
  const rows = (html: string) => (html.match(/<li><a href="\/product\//g) ?? []).length;
  const all = rows(cat.html);
  const search = await get(anon, '/catalog?q=gayo');
  const featured = await get(anon, '/catalog?featured=1');
  const none = await get(anon, '/catalog?q=tidakadaproduksepertiini');
  check(
    'R-9 search, featured filter and sort work WITHOUT JavaScript (plain GET, server-side)',
    rows(search.html) === 1 && rows(featured.html) < all && rows(featured.html) > 0,
    `semua=${all} cari=${rows(search.html)} unggulan=${rows(featured.html)}`,
  );
  check(
    'R-9 a search with no hits says so instead of showing everything',
    rows(none.html) === 0 && none.html.includes('data-testid="catalog-empty"'),
  );
  const asc = await get(anon, '/catalog?sort=price&order=asc');
  const desc = await get(anon, '/catalog?sort=price&order=desc');
  const firstPrice = (html: string) =>
    /<strong class="block text-foreground">([^<]+)<\/strong>/.exec(html)?.[1] ?? '';
  check(
    'R-9 sorting by price flips with `order`',
    firstPrice(asc.html) !== '' && firstPrice(asc.html) !== firstPrice(desc.html),
    `${firstPrice(asc.html)} vs ${firstPrice(desc.html)}`,
  );
  const sm = await get(anon, '/sitemap.xml', 'application/xml');
  check('R-9 both arrangements are in the sitemap', sm.html.includes(`${WEB}/catalog`));

  // F-5/F-7: which arrangement answers `/` is an admin's setting, not a deploy.
  const settings = await get(admin, '/settings?scope=global');
  const saved = await post(admin, '/settings?/save', {
    _csrf: csrfOf(settings.html),
    _scope: 'global',
    _section: 'app',
    _keys: ['app.landing_route'],
    'app.landing_route': '/catalog',
  });
  const front = await get(anon, '/');
  check(
    'R-9 `app.landing_route=/catalog` → `/` serves the catalogue on the next request, no restart',
    saved.res.status === 303 &&
      front.res.status === 200 &&
      front.res.headers.get('x-landing-route') === '/catalog' &&
      front.html.includes('data-testid="catalog-items"'),
    `${saved.res.status} ${front.res.headers.get('x-landing-route')}`,
  );
  const back = await get(admin, '/settings?scope=global');
  await post(admin, '/settings?/save', {
    _csrf: csrfOf(back.html),
    _scope: 'global',
    _section: 'app',
    _keys: ['app.landing_route'],
    'app.landing_route': '',
  });
  check(
    'R-9 back to the default landing for whatever runs next',
    (await get(anon, '/')).res.headers.get('x-landing-route') === '/example',
  );
}

// ---- #4: Example disabled → app whole, / falls back ----
{
  const modules = await get(admin, '/modules');
  const off = await post(admin, '/modules?/toggle', {
    _csrf: csrfOf(modules.html),
    module: 'Example',
    scope: 'global',
    state: 'off',
  });
  check('disable Example globally → 303', off.res.status === 303);
  const front = await get(anon, '/');
  check(
    '#4 `/` still 200 with the built-in landing (not 404)',
    front.res.status === 200 &&
      !front.res.headers.get('x-landing-route') &&
      !front.html.includes('data-testid="products"'),
  );
  const gone = await get(anon, '/example');
  check(
    '#4 /example → 404 while disabled; /product/<slug> too',
    gone.res.status === 404 && (await get(anon, '/product/gayo-arabika')).res.status === 404,
  );
  const dash = await get(admin, '/dashboard');
  check(
    '#4 dashboard whole: menu without Example entries, widget gone',
    dash.res.status === 200 &&
      !dash.html.includes('/m/example/products') &&
      !dash.html.includes('widget-example'),
  );
  const sm = await get(anon, '/sitemap.xml', 'application/xml');
  check('#4 sitemap without the disabled module', !sm.html.includes('/product/'));
  const on = await post(admin, '/modules?/toggle', {
    _csrf: csrfOf((await get(admin, '/modules')).html),
    module: 'Example',
    scope: 'global',
    state: 'on',
  });
  check(
    're-enable → landing back on the next request',
    on.res.status === 303 &&
      (await get(anon, '/')).res.headers.get('x-landing-route') === '/example',
  );
}

console.log(
  failures === 0
    ? '\nGATE M4 #1 #3 #4 (+R-3/R-4/R-9/F-7): LOLOS'
    : `\nGATE M4: GAGAL (${failures})`,
);
process.exit(failures === 0 ? 0 : 1);
