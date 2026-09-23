import { expect, test } from '@playwright/test';

/**
 * The users list's enhanced layer (D-1, L-16 over L-22) in a real browser: search and the group
 * filter answer over fetch, and the search box keeps the focus after Enter or a click on the
 * button. A marker on `window` is the proof that nothing reloaded — a full page load wipes it.
 */
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.test';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'bootstrap admin password';

declare global {
  interface Window {
    __usersMark?: number;
  }
}

test('users: search and group filter run over fetch, focus stays in the box', async ({ page }) => {
  await page.goto('/auth/login');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.locator('main form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto('/users');
  await expect(page.locator('h1')).toContainText(/Pengguna|Users/);
  // The enhanced layer marks the form once hydrated; typing before that would hit the base layer.
  await expect(page.locator('[data-testid="dt-search"]')).toHaveAttribute('data-enhanced', 'true');
  const mark = Date.now();
  await page.evaluate((m) => {
    window.__usersMark = m;
  }, mark);
  const survived = () => page.evaluate(() => window.__usersMark);
  const q = page.locator('[data-testid="dt-search"] input[name="q"]');
  // The users table only: the invitations card below has a table of its own.
  const rows = page.locator('.dt tbody');

  // Typing searches on its own (debounced) — no submit, no reload — and the box keeps focus + text.
  await q.fill('zzz-nobody-matches-this');
  await expect(page).toHaveURL(/[?&]q=zzz-nobody-matches-this/, { timeout: 10_000 });
  await expect(rows).toContainText(/Coba kata kunci lain|Try another keyword/);
  expect(await survived()).toBe(mark);
  await expect(q).toBeFocused();
  await expect(q).toHaveValue('zzz-nobody-matches-this');

  // Enter submits the form over fetch; the focus does not leave the box. The whole e-mail, so a
  // database full of other admins (leftovers of integration runs) still puts this one on page 1.
  const decodedUrl = () => decodeURIComponent(page.url());
  await q.fill(EMAIL);
  await q.press('Enter');
  await expect.poll(decodedUrl, { timeout: 10_000 }).toContain(`q=${EMAIL}`);
  await expect(rows).toContainText(EMAIL);
  expect(await survived()).toBe(mark);
  await expect(q).toBeFocused();

  // The search button too: the click moves focus to the button, the submit hands it back.
  await page.locator('[data-testid="dt-search"] button[type="submit"]').click();
  await expect(q).toBeFocused();
  expect(await survived()).toBe(mark);

  // The group filter applies on change, keeps `q`, and is a client-side navigation as well.
  const group = page.getByTestId('users-group');
  await expect(group).toBeVisible();
  const options = group.locator('option');
  if ((await options.count()) > 1) {
    const value = await options.nth(1).getAttribute('value');
    await group.selectOption(value ?? '');
    await expect(page).toHaveURL(new RegExp(`[?&]group=${value}`), { timeout: 10_000 });
    expect(decodedUrl()).toContain(`q=${EMAIL}`);
    expect(await survived()).toBe(mark);
    // Sorting is a link and keeps the filter.
    await page.getByRole('link', { name: /^Email/ }).click();
    await expect(page).toHaveURL(/[?&]sort=email/);
    await expect(page).toHaveURL(new RegExp(`[?&]group=${value}`));
    expect(await survived()).toBe(mark);
    // Back to all groups.
    await group.selectOption('');
    await expect(page).not.toHaveURL(/[?&]group=/, { timeout: 10_000 });
    expect(await survived()).toBe(mark);
  }
});
