import { expect, test } from '@playwright/test';

/**
 * Show/hide password beyond the login page (owner's ask, 2026-09-22): the profile's change-password
 * card and the user detail's set-password card both render their fields through FormBuilder, which
 * hands `type: 'password'` fields to <PasswordInput>. One proof on /profile covers that path; the
 * sign-up form uses the same component in its `plain` mode (login.e2e.ts pins that mode).
 */
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.test';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'bootstrap admin password';

test('profil: setiap field kata sandi punya tombol tampil/sembunyikan', async ({ page }) => {
  await page.goto('/auth/login');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.locator('main form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto('/profile');
  const form = page.locator('form[action="?/password"]').first();
  const fields = form.locator('input[type="password"]');
  await expect(fields).toHaveCount(3); // current, new, confirm
  const toggles = form.getByTestId('password-toggle');
  await expect(toggles).toHaveCount(3);

  // Each toggle owns exactly its field: revealing the new password leaves the other two hidden.
  const newField = form.locator('input[name="newPassword"]');
  await newField.fill('correct horse battery staple');
  await toggles.nth(1).click();
  await expect(newField).toHaveAttribute('type', 'text');
  await expect(newField).toHaveValue('correct horse battery staple');
  await expect(form.locator('input[name="currentPassword"]')).toHaveAttribute('type', 'password');
  await expect(form.locator('input[name="confirm"]')).toHaveAttribute('type', 'password');
  await expect(toggles.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/\/profile/); // type="button": nothing was submitted

  await toggles.nth(1).click();
  await expect(newField).toHaveAttribute('type', 'password');
});
