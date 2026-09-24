import { expect, test } from '@playwright/test';

/**
 * Registration by invitation (A-13) in a real browser, owner's ask of 2026-09-24: both password
 * fields on /auth/join/<code> carry the show/hide toggle, and a confirmation that does not match the
 * password is refused by the web action before the API is ever called. The invitation itself is
 * created through the /users page as an admin, and the link is followed in a fresh, signed-out
 * context: the join page sends a signed-in visitor straight to the dashboard.
 */
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.test';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'bootstrap admin password';

test('join: kedua field kata sandi punya toggle, konfirmasi yang tidak cocok ditolak', async ({
  page,
  browser,
}) => {
  await page.goto('/auth/login');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.locator('main form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto('/users');
  const inviteForm = page.getByTestId('invite-form');
  await inviteForm.locator('input[name="email"]').fill(`e2e-join-${Date.now()}@example.test`);
  await inviteForm.locator('button[type="submit"]').click();
  const link = (await page.getByTestId('invite-sent').locator('code').textContent()) ?? '';
  expect(link).toMatch(/\/join\//);
  // The link carries the forwarded origin; only its path matters to the browser under test.
  const joinPath = new URL(link).pathname;

  const guest = await browser.newContext();
  const join = await guest.newPage();
  await join.goto(joinPath);
  await expect(join).toHaveURL(/\/auth\/join\//);
  const form = join.getByTestId('join-form');
  const password = form.locator('input[name="password"]');
  const confirm = form.locator('input[name="password_confirm"]');
  await expect(password).toHaveAttribute('type', 'password');
  await expect(confirm).toHaveAttribute('type', 'password');

  // One toggle per field, each owning exactly its own input.
  const toggles = form.getByTestId('password-toggle');
  await expect(toggles).toHaveCount(2);
  await password.fill('correct horse battery staple');
  await toggles.nth(0).click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).toHaveValue('correct horse battery staple');
  await expect(confirm).toHaveAttribute('type', 'password');
  await toggles.nth(0).click();
  await expect(password).toHaveAttribute('type', 'password');

  // Mismatch: refused by the form action, the visitor stays on the page with the error shown.
  await form.locator('input[name="name"]').fill('Tamu E2E');
  await confirm.fill('correct horse battery stapler');
  await form.locator('button[type="submit"]').click();
  await expect(join).toHaveURL(/\/auth\/join\//);
  await expect(form.locator('..').locator('p.error')).toContainText(/tidak sama|does not match/);
  await expect(confirm).toHaveAttribute('aria-invalid', 'true');

  // Matching confirmation: the account is created and the session opened.
  await password.fill('correct horse battery staple');
  await confirm.fill('correct horse battery staple');
  await form.locator('button[type="submit"]').click();
  await expect(join).toHaveURL(/\/dashboard/);
  await guest.close();
});
