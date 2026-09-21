import { expect, test } from '@playwright/test';

/**
 * Settings tabs on a phone: the tab row stays ONE line and scrolls sideways rather than wrapping
 * into a stack of rows — the owner's ask (2026-09-22). Pinned at 390px, where the row is wider
 * than the screen for sure.
 */
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.test';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'bootstrap admin password';

test.use({ viewport: { width: 390, height: 844 } });

test('pengaturan: tab satu baris yang bisa digeser di layar sempit', async ({ page }) => {
  await page.goto('/auth/login');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.locator('main form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto('/settings');
  const tablist = page.getByRole('tablist');
  await expect(tablist).toBeVisible();
  const tabs = tablist.getByRole('tab');
  const n = await tabs.count();
  expect(n).toBeGreaterThan(1);

  // One line: every tab shares the first tab's vertical position.
  const boxes = await tabs.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
  for (const top of boxes) expect(Math.round(top)).toBe(Math.round(boxes[0] ?? 0));

  // Wider than the screen, and the overflow is scrollable rather than clipped or wrapped.
  const metrics = await tablist.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    overflowX: getComputedStyle(el).overflowX,
  }));
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
  expect(metrics.overflowX).toBe('auto');

  // Picking the last tab scrolls it into view — the row moved, the page did not.
  await tabs.last().evaluate((el) => (el as HTMLElement).click());
  await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => tablist.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});
