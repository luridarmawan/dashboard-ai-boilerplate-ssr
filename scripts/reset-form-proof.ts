#!/usr/bin/env bun
/**
 * Proof for the reset-password page (A-7) through the WEB app with plain HTTP — no browser, no
 * JavaScript: a mismatching confirmation is refused by the form action before the API is called,
 * a matching one sets the password and the account signs in with it. The one-time token cannot
 * be read back from any page (the e-mail body never reaches the UI), so the row is planted in the
 * database exactly as the API's own integration test does. Runs against the stack started by
 * scripts/ci/m1-proof.sh; the throwaway account is created there through /users/new.
 *
 *   WEB_URL=… ADMIN_EMAIL=… ADMIN_PASSWORD=… DATABASE_URL=… bun run scripts/reset-form-proof.ts
 */
const WEB = (process.env.WEB_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const ADMIN_EMAIL =
  process.env.ADMIN_EMAIL ?? process.env.BOOTSTRAP_ADMIN_EMAIL ?? 'admin@example.test';
const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ?? process.env.BOOTSTRAP_ADMIN_PASSWORD ?? 'bootstrap admin password';
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
function check(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? '  ✓' : '  ✗'} ${name}${cond || !extra ? '' : ` — ${extra}`}`);
  if (!cond) failures++;
}
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
const errorOf = (html: string) =>
  /class="error">([^<]*)/.exec(html)?.[1]?.trim() ?? `(no error banner; ${html.length} bytes)`;
const location = (res: Response) => res.headers.get('location') ?? '';
async function login(jar: Jar, email: string, password: string) {
  const page = await get(jar, '/auth/login');
  const r = await post(jar, '/auth/login', {
    _csrf: csrfOf(page.html),
    email,
    password,
    next: '/dashboard',
  });
  return { status: r.res.status, location: location(r.res), html: r.html };
}

console.log(`reset-password form via web at ${WEB}`);

// 1. a throwaway account, created by the admin through the web form
const email = `reset-${run}@example.test`;
const admin = new Jar();
{
  const r = await login(admin, ADMIN_EMAIL, ADMIN_PASSWORD);
  check('admin login → 303 /dashboard', r.status === 303, `${r.status} ${errorOf(r.html)}`);
  const page = await get(admin, '/users/new');
  const c = await post(admin, '/users/new', {
    _csrf: csrfOf(page.html),
    name: 'Reset Proof',
    email,
    password: 'the password before the reset',
    groupIds: [],
  });
  check(
    'create user → 303 to its page',
    c.res.status === 303,
    `${c.res.status} ${errorOf(c.html)}`,
  );
}

// 2. plant a one-time token — the same shape the API writes (apps/api/test/integration/auth.test.ts)
const { eq, getDb, newId, schema } = await import('@core/db');
const { hashToken, randomToken } = await import('@core/auth');
const db = getDb();
const [user] = await db
  .select({ id: schema.users.id })
  .from(schema.users)
  .where(eq(schema.users.email, email));
check('the account exists in the database', !!user);
const raw = randomToken();
await db.insert(schema.passwordResetTokens).values({
  id: newId(),
  user_id: user?.id ?? '',
  token_hash: hashToken(raw),
  expires_at: new Date(Date.now() + 10 * 60_000),
});

// 3. the page: two password fields, a confirmation among them, no toggle button in the HTML
const guest = new Jar();
const page = await get(guest, `/auth/reset?token=${raw}`);
check(
  'reset page renders the form for a valid token',
  page.html.includes('data-testid="reset-form"'),
);
check(
  'two password fields: password + password_confirm',
  page.html.includes('name="password"') && page.html.includes('name="password_confirm"'),
);
check(
  'no toggle button before hydration (it would be dead without JavaScript)',
  !page.html.includes('data-testid="password-toggle"'),
);
const csrf = csrfOf(page.html);

// 4. mismatch → refused by the web action, token untouched. The form has no `action`, so a
//    browser posts to the document URL, query string included — the proof does the same.
const newPassword = 'the password after the reset';
{
  const r = await post(guest, `/auth/reset?token=${raw}`, {
    _csrf: csrf,
    token: raw,
    password: newPassword,
    password_confirm: `${newPassword}!`,
  });
  check('mismatch → 422 on the same page', r.res.status === 422, `${r.res.status}`);
  check(
    'mismatch message shown, confirmation field flagged',
    /tidak sama|does not match/.test(r.html) && r.html.includes('aria-invalid="true"'),
    errorOf(r.html),
  );
  const again = await get(guest, `/auth/reset?token=${raw}`);
  check(
    'token still valid after the refused attempt',
    again.html.includes('data-testid="reset-form"'),
  );
  const old = await login(new Jar(), email, 'the password before the reset');
  check('old password still works', old.status === 303, `${old.status}`);
}

// 5. match → password set, token spent, the new password signs in
{
  const r = await post(guest, `/auth/reset?token=${raw}`, {
    _csrf: csrf,
    token: raw,
    password: newPassword,
    password_confirm: newPassword,
  });
  check(
    'match → 303 /auth/login?reset=1',
    r.res.status === 303 && location(r.res) === '/auth/login?reset=1',
    `${r.res.status} ${location(r.res)} ${r.res.status === 303 ? '' : errorOf(r.html)}`,
  );
  const spent = await get(new Jar(), `/auth/reset?token=${raw}`);
  check('token spent: the page refuses it now', !spent.html.includes('data-testid="reset-form"'));
  const fresh = await login(new Jar(), email, newPassword);
  check('new password signs in', fresh.status === 303, `${fresh.status} ${errorOf(fresh.html)}`);
  const stale = await login(new Jar(), email, 'the password before the reset');
  check('old password refused', stale.status !== 303, `${stale.status}`);
}

console.log(failures === 0 ? 'RESET FORM: PASS' : `RESET FORM: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
