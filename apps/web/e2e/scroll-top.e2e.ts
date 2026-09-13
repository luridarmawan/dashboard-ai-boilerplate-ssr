import { expect, test } from '@playwright/test';

/**
 * The back-to-top button (F-10) in a real browser — the only place it can be proved, because the
 * button exists only once JavaScript is running and only once the reader has scrolled.
 *
 * What is under test is the component, not the dataset: the button earns its place only past
 * `THRESHOLD` (ScrollTop.svelte), and how far a freshly seeded five-row product list scrolls at a
 * 400px viewport lands right around that line — enough on one database, not on another (and
 * mvp.e2e.ts adds and removes a row while this runs). A spacer under the real page gives every run
 * the same room to scroll; the guard below then checks the room, not merely that there is some.
 */
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.test';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'bootstrap admin password';
/** Mirrors `THRESHOLD` in apps/web/src/lib/components/ScrollTop.svelte. */
const THRESHOLD = 400;

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
  // Room to scroll well past the threshold, whatever the table holds today.
  await page.evaluate((px) => {
    const spacer = document.createElement('div');
    spacer.style.height = `${px}px`;
    document.body.append(spacer);
  }, THRESHOLD * 3);
  // The page must actually scroll past the threshold, or the rest of this proves nothing.
  expect(
    await page.evaluate(
      (px) => document.documentElement.scrollHeight - window.innerHeight > px,
      THRESHOLD,
    ),
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
