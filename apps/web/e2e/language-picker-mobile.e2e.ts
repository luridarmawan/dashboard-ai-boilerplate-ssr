import { expect, test } from '@playwright/test';

/**
 * Language picker on a phone: on public pages it lives inside the mobile menu, a dropdown nested in
 * a dropdown. Opening the inner one used to close every other dropdown — its own parent included —
 * so the menu vanished and no language could be picked. The bug only exists once `use:dropdown`
 * has hydrated (without JavaScript both are plain <details>), so the test waits for that first.
 */
test.use({ viewport: { width: 390, height: 844 } });

test('pemilih bahasa: bisa dipilih dari menu ponsel', async ({ page }) => {
  await page.goto('/');
  const menu = page.locator('header details:has([data-testid="language-picker"])').first();
  await expect(menu).toHaveAttribute('data-dropdown', '');
  const before = await page.locator('html').getAttribute('lang');
  const target = before === 'en' ? 'id' : 'en';

  await menu.locator('> summary').click();
  const picker = menu.getByTestId('language-picker');
  await picker.locator('> summary').click();
  // The parent menu must stay open while its submenu is.
  await expect(menu).toHaveJSProperty('open', true);
  await expect(picker).toHaveJSProperty('open', true);

  const option = picker.locator(`button[value="${target}"]`);
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.locator('html')).toHaveAttribute('lang', target);
});
