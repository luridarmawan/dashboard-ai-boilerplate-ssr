import { expect, test } from '@playwright/test';

/**
 * The back-to-top button (F-10) in a real browser — the only place it can be proved, because the
 * button exists only once JavaScript is running and only once the reader has scrolled. The short
 * viewport is what makes the page long enough to scroll on any dataset.
 */
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.test';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'bootstrap admin password';

test('back to top: appears after scrolling, and takes the page back up', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 400 });
  await page.goto('/auth/login');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.locator('main form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto('/m/example/products');
  const button = page.getByTestId('scroll-top');
  // At the top of the page there is nothing to go back to.
  await expect(button).toHaveCount(0);
  // The page must actually be scrollable, or the rest of this proves nothing.
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight),
  ).toBe(true);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(button).toBeVisible();
  // It shares the corner with the floating chat (H-13), so it sits above it, never on top of it.
  const chat = page.getByTestId('floating-chat-button');
  if (await chat.count()) {
    const [top, chatTop] = await Promise.all([
      button.boundingBox().then((b) => b?.y ?? 0),
      chat.boundingBox().then((b) => b?.y ?? 0),
    ]);
    expect(top + 8).toBeLessThan(chatTop);
  }

  await button.click();
  await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5_000 }).toBe(0);
  // Back at the top, the button has nothing left to do.
  await expect(button).toHaveCount(0);
});
