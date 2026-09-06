#!/usr/bin/env bun
/**
 * M5 gate proof over plain HTTP (no browser):
 *   #1 streaming provider → API → SvelteKit → UI: the web bridge returns SSE token by token
 *   #2 every call logged with tokens & latency (visible on /m/ai/logs)
 *   #3 disabling the AI module for the tenant removes menu, routes and widget — rest intact
 *   + H-4 (no key → actionable message), H-6/H-8 (history persisted, markdown rendered on reload)
 * Needs the mock provider (bun run ai:mock) at MOCK_URL (default http://127.0.0.1:4010/v1).
 */
const WEB = (process.env.WEB_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const MOCK = process.env.MOCK_URL ?? 'http://127.0.0.1:4010/v1';
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
async function post(
  jar: Jar,
  path: string,
  fields: Record<string, string | string[]>,
  accept = 'text/html',
) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields))
    for (const x of Array.isArray(v) ? v : [v]) body.append(k, x);
  const res = await fetch(`${WEB}${path}`, {
    method: 'POST',
    headers: {
      cookie: jar.header(),
      origin: WEB,
      accept,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
    redirect: 'manual',
  });
  jar.absorb(res);
  return res;
}
const csrfOf = (html: string) => /name="_csrf" value="([^"]+)"/.exec(html)?.[1] ?? '';
async function saveSection(jar: Jar, section: string, values: Record<string, string>) {
  const page = await get(jar, '/settings?scope=global');
  const r = await post(jar, '/settings?/save', {
    _csrf: csrfOf(page.html),
    _scope: 'global',
    _section: section,
    _keys: Object.keys(values),
    _secrets: Object.keys(values).filter((k) => k === 'ai.key'),
    _bools: Object.keys(values).filter((k) => k === 'ai.enable'),
    ...values,
    ...(values['ai.enable'] !== undefined ? { 'ai.enable__tri': 'set' } : {}),
  });
  return r.status;
}

console.log(`M5 gates via web at ${WEB} (mock provider ${MOCK})`);
const admin = new Jar();
{
  const page = await get(admin, '/auth/login');
  const r = await post(admin, '/auth/login', {
    _csrf: csrfOf(page.html),
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    next: '/dashboard',
  });
  check('admin login', r.status === 303, `${r.status}`);
  const mods = await get(admin, '/modules');
  await post(admin, '/modules?/toggle', {
    _csrf: csrfOf(mods.html),
    module: 'AI',
    scope: 'global',
    state: 'on',
  });
  check(
    'configure provider from the UI (baseurl → mock, key cleared first)',
    (await saveSection(admin, 'ai', {
      'ai.baseurl': MOCK,
      'ai.key': '__clear__',
      'ai.enable': 'on',
    })) === 303,
  );
}

// ---- H-4: no key → clear message, no generic 500 ----
{
  const chat = await get(admin, '/m/ai/chat');
  check(
    'chat page renders (menu entry present, widget on dashboard)',
    chat.res.status === 200 && (await get(admin, '/dashboard')).html.includes('widget-ai'),
  );
  const r = await post(admin, '/m/ai/chat?/send', {
    _csrf: csrfOf(chat.html),
    c: '',
    content: 'Halo tanpa kunci',
  });
  const back = await get(admin, r.headers.get('location') ?? '/m/ai/chat');
  check(
    'H-4 sending without an API key → actionable message (Pengaturan → AI), not a generic error',
    r.status === 303 && back.html.includes('API key belum diisi'),
    `${r.status} ${r.headers.get('location')}`,
  );
  check('configure the key', (await saveSection(admin, 'ai', { 'ai.key': 'test-key' })) === 303);
}

// ---- no-JS send (H-6, H-8) ----
let convId = '';
{
  const chat = await get(admin, '/m/ai/chat');
  const r = await post(admin, '/m/ai/chat?/send', {
    _csrf: csrfOf(chat.html),
    c: '',
    content: 'Ceritakan tentang kopi Gayo',
  });
  convId = /c=([0-9a-f-]{36})/.exec(r.headers.get('location') ?? '')?.[1] ?? '';
  check(
    'no-JS send → 303 to the (new) conversation',
    r.status === 303 && convId.length === 36,
    `${r.status} ${r.headers.get('location')}`,
  );
  const page = await get(admin, `/m/ai/chat?c=${convId}`);
  check(
    'H-6 history persisted and reloaded: user + assistant messages present',
    page.html.includes('data-role="user"') &&
      page.html.includes('data-role="assistant"') &&
      page.html.includes('Ceritakan tentang kopi Gayo'),
  );
  check(
    'H-8 assistant markdown rendered & sanitized server-side (<strong>, <code>, no raw **)',
    page.html.includes('<strong>markdown</strong>') &&
      page.html.includes('<code>kode</code>') &&
      page.html.includes('class="code-block"'),
  );
  check(
    'H-6 auto title from the first message shows in the sidebar',
    page.html.includes('Ceritakan tentang kopi Gayo</a>'),
  );
  check(
    'H-5 the system prompt was injected (mock marks it)',
    page.html.includes('with system prompt'),
  );
}

// ---- #1 streaming through the web bridge ----
{
  const chat = await get(admin, `/m/ai/chat?c=${convId}`);
  const started = performance.now();
  const res = await fetch(`${WEB}/m/ai/chat/stream`, {
    method: 'POST',
    headers: {
      cookie: admin.header(),
      origin: WEB,
      accept: 'text/event-stream',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      _csrf: csrfOf(chat.html),
      c: convId,
      content: 'stream test',
      history: '[]',
    }),
  });
  check(
    '#1 bridge answers 200 text/event-stream',
    res.status === 200 && (res.headers.get('content-type') ?? '').includes('text/event-stream'),
    `${res.status} ${res.headers.get('content-type')}`,
  );
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const dec = new TextDecoder();
  let chunks = 0;
  let firstAt = 0;
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks++;
    if (!firstAt) firstAt = performance.now() - started;
    text += dec.decode(value, { stream: true });
  }
  const total = performance.now() - started;
  check(
    '#1 tokens arrive incrementally (many chunks; first chunk well before the end)',
    chunks > 5 && firstAt < total / 2 && text.includes('[DONE]'),
    `${chunks} chunks, first ${Math.round(firstAt)}ms of ${Math.round(total)}ms`,
  );
  // cancellation: abort after the first chunk; the API must log `cancelled`
  const ac = new AbortController();
  const res2 = await fetch(`${WEB}/m/ai/chat/stream`, {
    method: 'POST',
    headers: {
      cookie: admin.header(),
      origin: WEB,
      accept: 'text/event-stream',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      _csrf: csrfOf(chat.html),
      c: convId,
      content: 'abort me please with a long long long answer',
      history: '[]',
    }),
    signal: ac.signal,
  });
  const rd = (res2.body as ReadableStream<Uint8Array>).getReader();
  await rd.read();
  ac.abort();
  await new Promise((r) => setTimeout(r, 700));
  const logs = await get(admin, '/m/ai/logs');
  check(
    '#2 /m/ai/logs shows calls with tokens, latency, first-token ms and a `cancelled` row',
    logs.res.status === 200 &&
      logs.html.includes('stream') &&
      /\d+ \/ \d+/.test(logs.html) &&
      logs.html.includes('cancelled') &&
      logs.html.includes('1st '),
    `${logs.res.status}`,
  );
}

// ---- #3 disable per tenant ----
{
  const mods = await get(admin, '/modules');
  const off = await post(admin, '/modules?/toggle', {
    _csrf: csrfOf(mods.html),
    module: 'AI',
    scope: 'tenant',
    state: 'off',
  });
  check('disable AI for the tenant → 303', off.status === 303);
  const dash = await get(admin, '/dashboard');
  check(
    '#3 menu entry and widget gone; dashboard intact',
    dash.res.status === 200 &&
      !dash.html.includes('href="/m/ai/chat"') &&
      !dash.html.includes('widget-ai') &&
      dash.html.includes('href="/users"'),
    `${dash.res.status} menu:${dash.html.includes('href="/m/ai/chat"')} widget:${dash.html.includes('widget-ai')} users:${dash.html.includes('href="/users"')} :: ${dash.html.slice(dash.html.indexOf('/m/ai/chat') - 200, dash.html.indexOf('/m/ai/chat') + 60).replace(/\s+/g, ' ')}`,
  );
  const chat = await get(admin, '/m/ai/chat');
  check(
    '#3 the chat route is refused (module_disabled surfaces as an error page)',
    chat.res.status === 403,
    `${chat.res.status}`,
  );
  const on = await post(admin, '/modules?/toggle', {
    _csrf: csrfOf((await get(admin, '/modules')).html),
    module: 'AI',
    scope: 'tenant',
    state: 'inherit',
  });
  check(
    'restore → chat back',
    on.status === 303 && (await get(admin, '/m/ai/chat')).res.status === 200,
  );
}

console.log(
  failures === 0
    ? '\nGATE M5 #1 #2 #3 (+H-4 H-5 H-6 H-8): LOLOS'
    : `\nGATE M5: GAGAL (${failures})`,
);
process.exit(failures === 0 ? 0 : 1);
