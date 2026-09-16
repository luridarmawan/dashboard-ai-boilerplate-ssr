import { expect, test } from '@playwright/test';

/**
 * The clock the settings form draws under a `timezone` field (E-3). It is server-rendered, so the
 * value is right with JavaScript off; what a browser has to show is the rest of the promise — it
 * ticks, and it follows the zone being typed instead of the one last saved, which is what makes
 * "is Asia/Makassar the zone I mean?" answerable before pressing Save.
 */
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.test';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'bootstrap admin password';

test('settings: jam di bawah Zona waktu berdetik dan mengikuti zona yang diketik', async ({
  page,
}) => {
  await page.goto('/auth/login');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.locator('main form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto('/settings');
  const clock = page.getByTestId('timezone-clock');
  const time = page.getByTestId('timezone-clock-time');
  await expect(clock).toBeVisible();

  const first = await time.textContent();
  await expect(time).not.toHaveText(first ?? '', { timeout: 5_000 });

  // Typing another zone moves the clock, without saving anything.
  const field = page.locator('#f-app\\.timezone');
  await field.fill('Pacific/Auckland');
  await expect(clock).toHaveAttribute('data-timezone', 'Pacific/Auckland');
  await expect(clock).toContainText('Pacific/Auckland');

  // A name Intl does not know says so instead of showing a wrong time.
  await field.fill('Mars/Olympus');
  await expect(time).toHaveCount(0);
  await expect(clock).toContainText(/Zona waktu tidak dikenal|Unknown timezone/);
});
