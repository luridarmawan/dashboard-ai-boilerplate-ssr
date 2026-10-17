import { expect, test } from '@playwright/test';

/**
 * The Pages module's permalink form in a real browser: changing the slug of a published page goes
 * over fetch, the permalink and the list of redirecting old addresses update in place, and a
 * toast says the old URL now redirects. A marker on `window` proves nothing reloaded. The 301
 * itself is checked over plain HTTP in modules/Pages/test/web/redirects.test.ts.
 */
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.test';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'bootstrap admin password';

declare global {
  interface Window {
    __pagesMark?: number;
  }
}

test('pages: changing a permalink updates in place and announces the redirect', async ({
  page,
}) => {
  const run = Date.now();
  const first = `e2e-${run}-about-us`;
  const second = `e2e-${run}-about-our-company`;

  await page.goto('/auth/login');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.locator('main form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/);

  // A published page, created through the ordinary form.
  await page.goto('/m/pages/pages/new');
  // Fill only once hydrated: in a slow dev build, hydration would reset the select afterwards.
  await expect(page.locator('main form[data-enhanced="true"]')).toBeVisible();
  await page.fill('input[name="title"]', `About ${run}`);
  await page.fill('input[name="slug"]', first);
  await page.selectOption('select[name="status"]', 'published');
  await page.locator('main form button[type="submit"]').first().click();
  await expect(page).toHaveURL(/\/m\/pages\/pages\/[0-9a-f-]{36}/);
  await expect(page.getByTestId('pages-permalink')).toContainText(`/${first}`);
  await expect(page.getByTestId('pages-redirects-empty')).toBeVisible();

  const form = page.getByTestId('pages-permalink-form');
  await expect(form).toHaveAttribute('data-enhanced', 'true');
  const mark = Date.now();
  await page.evaluate((m) => {
    window.__pagesMark = m;
  }, mark);
  const urlBefore = page.url();

  await page.fill('#pages-slug', second);
  await form.locator('button[type="submit"]').click();

  // The toast lives in the toaster's live region (inline notices are role=status too).
  const toast = page
    .locator('[aria-live="polite"] [role="status"]')
    .filter({ hasText: `/${second}` });
  await expect(toast).toBeVisible({ timeout: 15_000 });
  await expect(toast).toContainText(`/${first}`);
  await expect(toast).toContainText('301');
  await expect(page.getByTestId('pages-permalink')).toContainText(`/${second}`);
  await expect(page.getByTestId('pages-redirects')).toContainText(`/${first}`);
  await expect(page.locator('#pages-slug')).toHaveValue(second);
  expect(page.url()).toBe(urlBefore);
  expect(await page.evaluate(() => window.__pagesMark)).toBe(mark);
});
