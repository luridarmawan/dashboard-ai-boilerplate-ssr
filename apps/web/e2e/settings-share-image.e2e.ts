import { expect, test } from '@playwright/test';

/**
 * Settings → Application → Default share image: an `image` setting uploaded from the generated
 * Settings form, saved over fetch (no reload), previewed, then removed again. Tenant scope, so
 * the global value anonymous visitors read is never touched by this test.
 */
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.test';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'bootstrap admin password';

/** A tiny but valid 2×1 PNG; the size reader only needs the header. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGP4z8DwHwyBNAA/0wf5Gqzk0AAAAABJRU5ErkJggg==',
  'base64',
);

test('settings: the default share image uploads, previews and clears without a reload', async ({
  page,
}) => {
  await page.goto('/auth/login');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.locator('main form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto('/settings?tab=app');
  const field = page.getByTestId('image-field-app.share_image');
  await expect(field).toBeVisible();
  const form = page.locator('form', { has: field });
  // Wait for hydration: the save button answers over fetch only once it is enhanced.
  await page.waitForLoadState('networkidle');
  const mark = Date.now();
  await page.evaluate((m) => {
    (window as unknown as { __shareMark: number }).__shareMark = m;
  }, mark);

  await field.locator('input[type="file"]').setInputFiles({
    name: 'share.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await form.locator('button[type="submit"]').last().click();
  const preview = field.getByTestId('image-field-preview');
  await expect(preview).toHaveAttribute('src', /^\/v1\/configuration\/image-file\/[0-9a-f-]{36}$/, {
    timeout: 15_000,
  });
  // The preview loads: the image route serves it.
  await expect
    .poll(() => preview.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBe(2);
  expect(
    await page.evaluate(() => (window as unknown as { __shareMark: number }).__shareMark),
  ).toBe(mark);

  // Remove it again: the field goes back to empty, still without a reload.
  await field.locator('input[name="app.share_image__clear"]').check();
  await form.locator('button[type="submit"]').last().click();
  await expect(field.getByTestId('image-field-empty')).toBeVisible({ timeout: 15_000 });
  expect(
    await page.evaluate(() => (window as unknown as { __shareMark: number }).__shareMark),
  ).toBe(mark);
});
