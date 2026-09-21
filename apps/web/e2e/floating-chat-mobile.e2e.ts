import { expect, test } from '@playwright/test';

/**
 * Floating chat on a phone (H-13): the panel is not a card floating over the page but the whole
 * viewport, and the round launcher underneath it steps aside — closing is the header's job. From
 * `sm` (640px) up the corner card of mvp.e2e.ts is unchanged; this file only pins the small case.
 */
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.test';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'bootstrap admin password';

test.use({ viewport: { width: 390, height: 844 } });

test('chat mengambang: layar penuh di peramban ponsel', async ({ page }) => {
  await page.goto('/auth/login');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.locator('main form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/);

  // Before hydration the launcher is a plain link to the chat page (the no-JavaScript fallback);
  // the panel only exists once it has become a <button>, so wait for that element specifically.
  const button = page.locator('button[data-testid="floating-chat-button"]');
  await expect(button).toBeVisible();
  await button.click();

  const panel = page.getByTestId('floating-chat-panel');
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error('panel or viewport not measurable');
  // Whole viewport, edge to edge — no margin, no corner card.
  expect(Math.round(box.x)).toBe(0);
  expect(Math.round(box.y)).toBe(0);
  expect(Math.round(box.width)).toBe(viewport.width);
  expect(Math.round(box.height)).toBe(viewport.height);
  // The launcher is gone while the panel is full screen; the header closes it.
  await expect(button).toBeHidden();
  await panel.getByRole('button', { name: /Tutup|Close/ }).click();
  await expect(panel).toHaveCount(0);
  await expect(button).toBeVisible();
});
