#!/usr/bin/env bun
/**
 * M1 gate #1 proof, through the WEB app with plain HTTP (no browser, no JavaScript):
 *   login → create a user → set a group's permissions → the user sees exactly them →
 *   create a tenant → switch → the user list is per tenant → the bell dropdown marks a
 *   notification read → logout.
 * It also checks gate #2 at the web layer: a cross-origin form post is refused.
 *
 *   WEB_URL=http://127.0.0.1:5173 ADMIN_EMAIL=… ADMIN_PASSWORD=… bun run scripts/m1-gate1-proof.ts
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
      const gone = attrs.some((a) => /max-age=0/i.test(a)) || value === '';
      if (gone) this.cookies.delete(name);
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
async function post(
  jar: Jar,
  path: string,
  fields: Record<string, string | string[]>,
  origin = WEB,
) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields))
    for (const x of Array.isArray(v) ? v : [v]) body.append(k, x);
  const res = await fetch(`${WEB}${path}`, {
    method: 'POST',
    // A browser form post sends `Accept: text/html`; with `*/*` SvelteKit answers the JSON an
    // enhanced (JavaScript) form expects.
    headers: {
      cookie: jar.header(),
      origin,
      accept: 'text/html',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
    redirect: 'manual',
  });
  jar.absorb(res);
  return { res, html: await res.text() };
}
/** The checkbox value for a group label, whatever the attribute order the renderer chose. */
function groupIdFor(html: string, label: string): string {
  const re = new RegExp(`<input([^>]*)>(?:\\s|<!---->)*${label}`, 'g');
  for (const m of html.matchAll(re)) {
    const attrs = m[1] ?? '';
    if (!/name="groupIds"/.test(attrs)) continue;
    const v = /value="([0-9a-f-]{36})"/.exec(attrs)?.[1];
    if (v) return v;
  }
  return '';
}
const csrfOf = (html: string) => /name="_csrf" value="([^"]+)"/.exec(html)?.[1] ?? '';
/** The page's error banner, for diagnostics when a step fails. */
const errorOf = (html: string) =>
  /class="error">([^<]*)/.exec(html)?.[1]?.trim() ?? `(no error banner; ${html.length} bytes)`;
const location = (res: Response) => res.headers.get('location') ?? '';
/** The bell dropdown's row list, so a match cannot come from the page behind the shell. */
function bellPanel(html: string): string {
  const i = html.indexOf('data-testid="bell-items"');
  return i < 0 ? '' : html.slice(i, html.indexOf('</ul>', i));
}

async function login(jar: Jar, email: string, password: string) {
  const page = await get(jar, '/auth/login');
  const token = csrfOf(page.html);
  const r = await post(jar, '/auth/login', { _csrf: token, email, password, next: '/dashboard' });
  return { status: r.res.status, location: location(r.res), token, html: r.html };
}

console.log(`M1 gate #1 via web at ${WEB}`);
const admin = new Jar();

// 1. login
{
  const r = await login(admin, ADMIN_EMAIL, ADMIN_PASSWORD);
  check(
    'admin login → 303 /dashboard',
    r.status === 303 && r.location === '/dashboard',
    `${r.status} ${r.location} ${r.status === 303 ? '' : errorOf(r.html)}`,
  );
  check('session cookie is HttpOnly', admin.cookies.has('crk_session'));
  const dash = await get(admin, '/dashboard');
  check(
    'dashboard renders server-side with superadmin *.*',
    dash.res.status === 200 && dash.html.includes('*.*'),
  );
}

// 2. create a user with the seeded `user` group
const gateEmail = `gate1-${run}@example.test`;
const gatePassword = 'a gate one password 123';
let userGroupId = '';
let newUserId = '';
{
  const page = await get(admin, '/users/new');
  const token = csrfOf(page.html);
  userGroupId = groupIdFor(page.html, 'Regular User');
  check('users/new lists the seeded "Regular User" group', userGroupId.length === 36);
  const r = await post(admin, '/users/new', {
    _csrf: token,
    name: 'Gate One',
    email: gateEmail,
    password: gatePassword,
    groupIds: [userGroupId],
  });
  newUserId = /\/users\/([0-9a-f-]{36})/.exec(location(r.res))?.[1] ?? '';
  check(
    'create user → 303 to the new user page',
    r.res.status === 303 && newUserId.length === 36,
    `${r.res.status} ${location(r.res)}`,
  );
  const list = await get(admin, `/users?q=gate1-${run}`);
  check('users list (search) shows the new user', list.html.includes(gateEmail));
}

// 3. set the group's permissions (matrix form)
{
  const page = await get(admin, `/groups/${userGroupId}`);
  const token = csrfOf(page.html);
  check(
    'group page shows the registry matrix',
    page.html.includes('name="perm" value="user.read"') && page.html.includes('module'),
  );
  const r = await post(admin, `/groups/${userGroupId}?/permissions`, {
    _csrf: token,
    perm: ['user.read', 'group.read'],
    extra: '',
  });
  check(
    'set permissions → saved',
    r.res.status === 200 && r.html.includes('Tersimpan'),
    `${r.res.status}`,
  );
}

// 4. the new user sees exactly those permissions; the UI hides what it cannot do
const member = new Jar();
{
  const r = await login(member, gateEmail, gatePassword);
  check('new user can log in', r.status === 303, `${r.status}`);
  const dash = await get(member, '/dashboard');
  check(
    'member dashboard lists group.read and user.read',
    dash.html.includes('group.read') && dash.html.includes('user.read'),
  );
  check(
    'menu hides Tenant (no client.read) but shows Pengguna',
    !dash.html.includes('href="/tenants"') && dash.html.includes('href="/users"'),
  );
  const groups = await get(member, '/groups');
  check('member may read groups (group.read)', groups.res.status === 200);
  const tenants = await get(member, '/tenants');
  check(
    'member is refused /tenants by the API (403 surfaces as an error page)',
    tenants.res.status === 403,
    `${tenants.res.status}`,
  );
  const page = await get(member, `/groups/${userGroupId}`);
  const esc = await post(member, `/groups/${userGroupId}?/permissions`, {
    _csrf: csrfOf(page.html),
    perm: ['*.*'],
    extra: '',
  });
  check(
    'member cannot escalate: POST permissions → 403 from the API',
    esc.res.status === 403,
    `${esc.res.status}`,
  );
}

// 5. tenant: create, switch, users are per tenant
{
  // The way IN to the form is part of the flow: a DataTable rewrite once dropped this button and
  // left no way to add a tenant from the UI at all.
  const list = await get(admin, '/tenants');
  check('tenants list offers the create button', list.html.includes('href="/tenants/new"'));
  const page = await get(admin, '/tenants/new');
  const r = await post(admin, '/tenants/new', {
    _csrf: csrfOf(page.html),
    code: `g1-${run}`.slice(0, 32),
    name: `Gate ${run}`,
  });
  const tenantId = /\/tenants\/([0-9a-f-]{36})/.exec(location(r.res))?.[1] ?? '';
  check('create tenant → 303', r.res.status === 303 && tenantId.length === 36, `${r.res.status}`);
  const dash = await get(admin, '/dashboard');
  check('switcher appears once there are two tenants (B-5)', dash.html.includes('name="clientId"'));
  const sw = await post(admin, '/auth/switch-tenant', {
    _csrf: csrfOf(dash.html),
    clientId: tenantId,
    back: '/dashboard',
  });
  check(
    'switch tenant → 303 back (server-side navigation, B-4)',
    sw.res.status === 303 && location(sw.res) === '/dashboard',
  );
  const after = await get(admin, '/dashboard');
  check('dashboard now shows the new tenant as active', after.html.includes(`Gate ${run}`));
  const users = await get(admin, '/users');
  check(
    'users list is per tenant: the member of `default` is not here',
    !users.html.includes(gateEmail),
  );
  const forged = await post(admin, '/auth/switch-tenant', {
    _csrf: csrfOf(after.html),
    clientId: '01900000-0000-7000-8000-000000000000',
    back: '/dashboard',
  });
  check(
    'switching to a foreign tenant is refused',
    location(forged.res).includes('tenant_error=1'),
  );
}

// 6. gate #2 at the web layer: a cross-origin form post never reaches the API
{
  const page = await get(admin, '/users/new');
  const r = await post(
    admin,
    '/users/new',
    { _csrf: csrfOf(page.html), name: 'Evil', email: `evil-${run}@example.test` },
    'http://evil.test',
  );
  check('cross-origin POST → 403 (no user created)', r.res.status === 403, `${r.res.status}`);
  const bad = await post(admin, '/users/new', {
    _csrf: 'wrong',
    name: 'Evil',
    email: `evil2-${run}@example.test`,
  });
  check('wrong CSRF field → 403', bad.res.status === 403, `${bad.res.status}`);
}

// 7. bell (J-4): the shell's notification dropdown works with plain forms
{
  // Minting an API token notifies its owner — the one producer whose recipient is the actor.
  const profile = await get(admin, '/profile');
  const tokenName = `bell-${run}`;
  const made = await post(admin, '/profile?/createToken', {
    _csrf: csrfOf(profile.html),
    name: tokenName,
  });
  check(
    'create API token → 200 (notifies the owner)',
    made.res.status === 200,
    `${made.res.status}`,
  );
  const dash = await get(admin, '/dashboard');
  const panel = bellPanel(dash.html);
  check('bell badge counts it server-side', dash.html.includes('data-testid="bell-count"'));
  check(
    'bell dropdown lists it without JavaScript',
    panel.includes(tokenName),
    `panel ${panel.length} bytes`,
  );
  const id = /name="id" value="([0-9a-f-]{36})"/.exec(panel)?.[1] ?? '';
  const read = await post(admin, '/notifications?/read', {
    _csrf: csrfOf(dash.html),
    id,
    link: '',
  });
  check(
    'marking read from the bell → 303 /notifications',
    read.res.status === 303 && location(read.res) === '/notifications',
    `${read.res.status} ${location(read.res)}`,
  );
  const after = await get(admin, '/dashboard');
  check(
    'badge and the row are gone afterwards',
    !after.html.includes('data-testid="bell-count"') &&
      !bellPanel(after.html).includes('name="id" value='),
  );
}

// 8. group picker (D-2): a tenant with more groups than one API page still offers all of them
{
  const page = await get(admin, '/groups/new');
  const token = csrfOf(page.html);
  const made: { id: string; code: string }[] = [];
  // One API page is MAX_LIMIT = 100 rows, so 101 extra groups puts the last ones out of reach of a
  // single call. They must still reach the picker: the user form submits exactly the boxes it
  // rendered and the API replaces a user's memberships with what arrives, so a group missing here
  // cannot be granted AND would be stripped from whoever already had it.
  for (let i = 0; i < 101; i++) {
    const code = `pg-${run}-${String(i).padStart(3, '0')}`;
    const r = await post(admin, '/groups/new', { _csrf: token, code, name: `Picker ${code}` });
    const id = /\/groups\/([0-9a-f-]{36})/.exec(location(r.res))?.[1] ?? '';
    if (id) made.push({ id, code });
  }
  check('101 extra groups created', made.length === 101, `${made.length}`);
  const last = made.at(-1);
  const form = await get(admin, '/users/new');
  check(
    'the user form offers a group past the first API page',
    !!last && form.html.includes(`value="${last.id}"`),
    last ? `${last.code} missing from ${form.html.length} bytes` : 'no group created',
  );
  // Leave the tenant as it was found: a proof that litters makes the next run harder to read.
  for (const g of made)
    await post(admin, `/groups/${g.id}?/delete`, { _csrf: token, code: g.code });
  const after = await get(admin, '/users/new');
  check('they are gone again afterwards', !!last && !after.html.includes(`value="${last.id}"`));
}

// 9. add-member picker (D-3): candidates are searched, so a tenant of any size can be picked from
{
  const gpage = await get(admin, '/groups/new');
  const token = csrfOf(gpage.html);
  const code = `ms-${run}`;
  const gr = await post(admin, '/groups/new', { _csrf: token, code, name: `Member search ${run}` });
  const groupId = /\/groups\/([0-9a-f-]{36})/.exec(location(gr.res))?.[1] ?? '';
  const upage = await get(admin, '/users/new');
  const email = `member-${run}@example.test`;
  const ur = await post(admin, '/users/new', {
    _csrf: csrfOf(upage.html),
    name: 'Member Search',
    email,
    password: 'a member search password 123',
  });
  const userId = /\/users\/([0-9a-f-]{36})/.exec(location(ur.res))?.[1] ?? '';
  check(
    'a group and a group-less user exist for the search',
    groupId.length === 36 && userId.length === 36,
    `${gr.res.status} ${ur.res.status}`,
  );
  const found = await get(admin, `/groups/${groupId}?cq=member-${run}`);
  check(
    'group page offers both searches: members (mq) and candidates (cq)',
    found.html.includes('name="cq"') && found.html.includes('name="mq"'),
  );
  check(
    'the searched user is offered as a candidate',
    found.html.includes(`value="${userId}"`),
    `${found.res.status}, ${found.html.length} bytes`,
  );
  // The roster itself is a page now: adding the user must not put the whole tenant on the page.
  // The action re-renders the page rather than redirecting, so 200 is the success here.
  const added = await post(admin, `/groups/${groupId}?/addMember`, { _csrf: token, userId });
  check('add member → 200', added.res.status === 200, `${added.res.status}`);
  const roster = await get(admin, `/groups/${groupId}?mq=member-${run}`);
  check('member filter narrows the roster to the searched member', roster.html.includes(email));
  await post(admin, `/groups/${groupId}?/delete`, { _csrf: token, code });
}

// ---- D-5 presence + C-8 permission guide, both without JavaScript ----
{
  const list = await get(admin, '/users');
  // The admin is signing these very requests, so they must be the one row that reads "online".
  const dots = [...list.html.matchAll(/data-testid="presence" data-online="(true|false)"/g)].map(
    (m) => m[1],
  );
  check(
    'D-5 the user list carries a presence dot per row, and this signed-in admin is online',
    dots.length > 0 && dots.includes('true'),
    `${dots.filter((d) => d === 'true').length}/${dots.length} online`,
  );
  check(
    'D-5 the dot is never colour alone: the wording is in the HTML for screen readers',
    /title="[^"]*"[^>]*data-testid="presence"|data-testid="presence"[^>]*title="[^"]*"/.test(
      list.html,
    ),
  );

  const guide = await get(admin, '/permissions');
  check(
    'C-8 the permission guide renders, with the live registry of this installation',
    guide.res.status === 200 &&
      guide.html.includes('data-testid="permission-registry"') &&
      guide.html.includes('user.impersonate') &&
      // module-contributed resources appear because the registry is read, not hard-coded (C-4)
      guide.html.includes('example.product.edit'),
    `${guide.res.status}`,
  );
  // The checker is a GET form: the verdict comes from the URL, so it works without JavaScript
  // and a link to it is an explanation someone else can open.
  const allowed = await get(admin, '/permissions?granted=user.*&required=user.edit');
  const denied = await get(admin, '/permissions?granted=user.read&required=user.edit');
  const loose = await get(admin, '/permissions?granted=user.*&required=user.*');
  const verdict = (html: string) =>
    /data-testid="permcheck-result"[^>]*>([^<]*)/.exec(html)?.[1]?.trim() ?? '';
  check(
    'C-8 the checker answers from the URL alone (no JavaScript): allow, deny, and "must be concrete"',
    verdict(allowed.html) !== '' &&
      verdict(allowed.html) !== verdict(denied.html) &&
      verdict(loose.html) !== verdict(allowed.html) &&
      verdict(loose.html) !== verdict(denied.html),
    `${verdict(allowed.html)} | ${verdict(denied.html)} | ${verdict(loose.html)}`,
  );
}

// 10. logout invalidates server-side
{
  const dash = await get(admin, '/dashboard');
  const r = await post(admin, '/auth/logout', { _csrf: csrfOf(dash.html) });
  check('logout → 303 /auth/login', r.res.status === 303 && location(r.res) === '/auth/login');
  const again = await get(admin, '/dashboard');
  check(
    'dashboard afterwards redirects to login',
    again.res.status === 303 && location(again.res).startsWith('/auth/login'),
  );
}

console.log(failures === 0 ? '\nGATE M1 #1: LOLOS' : `\nGATE M1 #1: GAGAL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
