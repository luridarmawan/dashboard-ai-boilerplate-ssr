import { expect, type Page, test } from '@playwright/test';

/**
 * Login over fetch (L-20 over L-22). The HTTP proofs cover the base layer — the plain form POST to
 * this page's action, which still works with JavaScript off. What a browser has to show is the
 * ENHANCED layer: both steps go to the API itself (POST /v1/auth/login) and the document is never
 * left behind. A marker on `window` is the proof — a conventional form POST would wipe it.
 *
 * That layer needs `/v1` on the web origin, which is what every real deployment does (Caddy, the
 * nginx/Apache examples, the Vite proxy in development — Decision E). This proof harness is the
 * one place it is not true: it runs the API and the built web app as two bare processes, with
 * nothing in front of them. So the test asserts whichever layer the topology allows — and the
 * fallback is itself worth pinning down: with the API out of reach the submit must still sign the
 * user in through the form action, exactly as it would with JavaScript off.
 */
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.test';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'bootstrap admin password';

/** Survives a client-side navigation, not a page load. */
const mark = () => {
  (window as unknown as { __noReload?: true }).__noReload = true;
};
const marked = () => (window as unknown as { __noReload?: true }).__noReload === true;

/** Is `/v1` the API here, or the web app's own 404? */
const apiOnSameOrigin = (page: Page) =>
  page.evaluate(async () => {
    try {
      const res = await fetch('/v1/health');
      return (res.headers.get('content-type') ?? '').includes('json');
    } catch {
      return false;
    }
  });

test('login: lewat fetch ke API, tanpa muat ulang halaman', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') posts.push(new URL(r.url()).pathname);
  });

  await page.goto('/auth/login');
  // `data-enhanced` appears on mount: a click before that posts the form the ordinary way, which
  // is correct behaviour but not what this test is about.
  const form = page.getByTestId('login-form');
  await expect(form).toHaveAttribute('data-enhanced', 'true');
  const enhanced = await apiOnSameOrigin(page);
  await page.evaluate(mark);
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await form.locator('button[type="submit"]').click();

  await expect(page).toHaveURL(/\/dashboard/);
  if (enhanced) {
    // The session cookie came from the API, and getting to the dashboard was a client-side
    // navigation: the page that submitted is still the page that is running.
    expect(posts).toEqual(['/v1/auth/login']);
    expect(await page.evaluate(marked)).toBe(true);
  } else {
    expect(posts).toEqual(['/auth/login']);
  }
});

test('login: kata sandi salah dijawab di halaman yang sama', async ({ page }) => {
  await page.goto('/auth/login');
  const form = page.getByTestId('login-form');
  await expect(form).toHaveAttribute('data-enhanced', 'true');
  const enhanced = await apiOnSameOrigin(page);
  await page.evaluate(mark);
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', `bukan-${Date.now()}`);
  await form.locator('button[type="submit"]').click();

  await expect(page.locator('p.error')).toContainText(/kata sandi/i);
  await expect(page).toHaveURL(/\/auth\/login/);
  // What was typed is still there to correct — the re-render must not wipe the field.
  await expect(form.locator('input[name="email"]')).toHaveValue(EMAIL);
  if (enhanced) expect(await page.evaluate(marked)).toBe(true);
});

test('login: API tak terjangkau → submit jatuh ke form action', async ({ page }) => {
  // What a deployment without the /v1 route in front of the web app looks like from the browser:
  // the fetch layer asks, gets something that is not the API, and hands the submit back.
  await page.route('**/v1/auth/login', (route) =>
    route.fulfill({ status: 404, contentType: 'text/html', body: '<!doctype html><h1>404</h1>' }),
  );
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') posts.push(new URL(r.url()).pathname);
  });

  await page.goto('/auth/login');
  const form = page.getByTestId('login-form');
  await expect(form).toHaveAttribute('data-enhanced', 'true');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await form.locator('button[type="submit"]').click();

  await expect(page).toHaveURL(/\/dashboard/);
  expect(posts).toEqual(['/v1/auth/login', '/auth/login']);
});
