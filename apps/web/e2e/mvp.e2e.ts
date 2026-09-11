import { expect, test } from '@playwright/test';

/**
 * PRD P-8 / §8: landing → login → CRUD → chat in a real browser with JavaScript ON (the HTTP proofs
 * cover the no-JS path). Runs against the stack started by scripts/ci/m1-proof.sh; the M5 proof has
 * already pointed the AI module at the mock provider.
 */
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.test';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'bootstrap admin password';
const run = Date.now();

test('landing → login → CRUD produk → chat AI streaming', async ({ page }) => {
  // Front door answers (whatever landing route the admin configured), then the Example landing
  // itself: SSR with SEO metadata (R-4). The HTTP proofs cover the `/` → landing forwarding rules.
  const front = await page.goto('/');
  expect(front?.status()).toBe(200);
  await page.goto('/example');
  await expect(page).toHaveTitle(/.+/);
  await expect(page.locator('h1').first()).toBeVisible();
  expect(await page.locator('link[rel="canonical"]').count()).toBe(1);

  // Login
  await page.goto('/auth/login');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.locator('main form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/);
  // F-3: module entries live in collapsible groups; the Example group is closed on /dashboard
  // (no active page inside), so open it before expecting its link to be visible.
  const exampleGroup = page.getByTestId('nav-group.example').first();
  await expect(exampleGroup).toBeAttached();
  await exampleGroup.locator('summary').click();
  await expect(page.locator('a[href="/m/example/products"]').first()).toBeVisible();

  // H-13: the floating chat is on every dashboard page; it streams with the page as context
  await page.getByTestId('floating-chat-button').click();
  const panel = page.getByTestId('floating-chat-panel');
  await expect(panel).toBeVisible();
  await panel.locator('textarea[name="content"]').fill(`Halaman apa ini? ${run}`);
  await panel.locator('form button[type="submit"]').click();
  await expect(page.getByTestId('floating-chat-messages')).toContainText(
    new RegExp(`Echo[^:]*: Halaman apa ini\\? ${run}`),
    { timeout: 15_000 },
  );
  await expect(page).toHaveURL(/\/dashboard/); // still on the page — no navigation
  await panel.getByRole('button', { name: /Tutup|Close/ }).click();
  await expect(panel).toHaveCount(0);

  // CRUD: create → edit → delete a product through the FormBuilder pages
  const slug = `e2e-${run}`;
  await page.goto('/m/example/products/new');
  await page.fill('input[name="name"]', `E2E Kopi ${run}`);
  await page.fill('input[name="slug"]', slug);
  await page.fill('input[name="price"]', '75000');
  await page
    .locator('main form')
    .first()
    .getByRole('button', { name: /Simpan|Save/ })
    .click();
  await expect(page).toHaveURL(/\/m\/example\/products\/[0-9a-f-]{36}\?saved=1/);
  await expect(page.getByText('Tersimpan')).toBeVisible();

  await page.fill('input[name="name"]', `E2E Kopi ${run} v2`);
  await page
    .locator('main form[action="?/save"]')
    .getByRole('button', { name: /Simpan|Save/ })
    .click();
  await expect(page.getByText('Tersimpan')).toBeVisible();
  await expect(page.locator('h1')).toContainText(`E2E Kopi ${run} v2`);

  // Public detail page from the database
  await page.goto(`/product/${slug}`);
  await expect(page.locator('h1')).toContainText(`E2E Kopi ${run} v2`);

  await page.goto('/m/example/products');
  await expect(page.getByText(`E2E Kopi ${run} v2`)).toBeVisible();
  await page
    .getByRole('row', { name: new RegExp(`E2E Kopi ${run} v2`) })
    .getByRole('link', { name: /Ubah|Edit/ })
    .click();
  // Deleting is never one click: with JavaScript the trigger opens the confirmation as a modal
  // (without it, the same link is a page step — the HTTP proofs cover that path).
  await page.locator('main a[href*="confirm=delete"]').click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toBeVisible();
  await confirm.locator('form[action^="?/delete"] button[type="submit"]').click();
  await expect(page).toHaveURL(/\/m\/example\/products\?saved=deleted/);
  await expect(page.getByText(`E2E Kopi ${run} v2`)).toHaveCount(0);

  // Chat: the reply streams into the message list without a page reload
  await page.goto('/m/ai/chat');
  const messages = page.getByTestId('messages');
  const before = await messages.locator('[data-role], article, li, div.rounded-lg').count();
  await page.fill('textarea[name="content"]', `Halo dari E2E ${run}`);
  await page.locator('main form[data-stream] button[type="submit"]').click();
  await expect(messages).toContainText(`Halo dari E2E ${run}`);
  // the mock provider answers "Echo…: <prompt> …" — it streams into the list while still on /m/ai/chat
  await expect(messages).toContainText(new RegExp(`Echo[^:]*: Halo dari E2E ${run}`), {
    timeout: 15_000,
  });
  expect(
    await messages.locator('[data-role], article, li, div.rounded-lg').count(),
  ).toBeGreaterThanOrEqual(before);
  // H-6: after the first exchange the page lands on the persisted conversation
  await expect(page).toHaveURL(/\/m\/ai\/chat\?c=[0-9a-f-]{36}/, { timeout: 15_000 });
  await expect(page.getByTestId('messages')).toContainText(`Halo dari E2E ${run}`);

  // Settings section action (extension point 6): the AI connection test runs in place. The point
  // of the assertion is the URL — a page load here would mean the button fell back to a form post.
  await page.goto('/settings');
  await page.locator('[data-tab="ai"]').click();
  const aiCard = page.locator('#ai');
  await aiCard.getByRole('button', { name: /Uji koneksi|Test connection/ }).click();
  await expect(page.getByTestId('action-result-ai-test')).toContainText(/Terhubung|Connected/, {
    timeout: 20_000,
  });
  await expect(page).toHaveURL(/\/settings$/);
});
