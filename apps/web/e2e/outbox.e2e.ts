import { expect, test } from '@playwright/test';

/**
 * The outbox page's enhanced layer (J-2, L-20) in a real browser. The HTTP proofs already cover
 * the no-JS base; what matters here is that the SAME controls answer over fetch. Every step
 * asserts against a marker put on `window`: a full page load would wipe it, so the marker
 * surviving is the proof that nothing reloaded.
 */
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.test';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'bootstrap admin password';

declare global {
  interface Window {
    __outboxMark?: number;
  }
}

test('outbox: search, filter and deliver run over fetch, not page loads', async ({ page }) => {
  await page.goto('/auth/login');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.locator('main form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto('/outbox');
  await expect(page.locator('h1')).toContainText(/Outbox email|Email outbox/);
  const mark = Date.now();
  await page.evaluate((m) => {
    window.__outboxMark = m;
  }, mark);
  const survived = () => page.evaluate(() => window.__outboxMark);

  // Typing searches on its own (debounced) — no submit, no reload.
  await page.fill('#outbox-q', 'zzz-nobody-matches-this');
  await expect(page).toHaveURL(/[?&]q=zzz-nobody-matches-this/, { timeout: 10_000 });
  await expect(page.locator('tbody')).toContainText(/Tidak ada email yang cocok|No e-mail matches/);
  expect(await survived()).toBe(mark);
  // The box keeps what was typed and the focus, which is the whole point of keepFocus.
  await expect(page.locator('#outbox-q')).toBeFocused();
  await expect(page.locator('#outbox-q')).toHaveValue('zzz-nobody-matches-this');

  // Clearing it brings the rows back, still without a load.
  await page.fill('#outbox-q', '');
  await expect(page).toHaveURL(/\/outbox$/, { timeout: 10_000 });
  expect(await survived()).toBe(mark);

  // A status chip is a plain link; SvelteKit navigates it client-side.
  await page.getByTestId('outbox-filter-sent').click();
  await expect(page).toHaveURL(/[?&]status=sent/);
  expect(await survived()).toBe(mark);

  // Sorting is a link too: the column header flips the order in place.
  await page.getByRole('link', { name: /Penerima|Recipient/ }).click();
  await expect(page).toHaveURL(/[?&]sort=to/);
  expect(await survived()).toBe(mark);

  // Page size is a select that applies on change.
  await page.selectOption('#outbox-limit', '20');
  await expect(page).toHaveURL(/[?&]limit=20/, { timeout: 10_000 });
  expect(await survived()).toBe(mark);

  // Dates read DD/MM HH:MM on a 24-hour clock — no year, no seconds, no AM/PM. The full
  // timestamp stays in `title`, so the short form loses nothing.
  const firstDate = page.locator('[data-testid="outbox-row"] td').first();
  if (await firstDate.count()) {
    await expect(firstDate).toHaveText(/^\d{2}\/\d{2} \d{2}:\d{2}$/);
    expect(await firstDate.getAttribute('title')).toBeTruthy();
  }

  // "Deliver now" posts over fetch: a toast reports the worker pass and the URL stays put —
  // the no-JS path would have redirected to `?delivered=…` instead.
  const urlBefore = page.url();
  await page.getByTestId('outbox-deliver').click();
  await expect(page.locator('[role="status"]')).toContainText(/Worker dijalankan|Worker run/, {
    timeout: 15_000,
  });
  expect(page.url()).toBe(urlBefore);
  expect(await survived()).toBe(mark);
});

/**
 * The table is wider than the shell at every realistic width, so the page's job is to keep it
 * inside `#outbox-monitor-container` and let it scroll there — never to push the whole document
 * sideways. `.page` is a bare `grid`, whose `auto` track sizes to its widest child, so without
 * `minmax(0,1fr)` the table drags the heading, filter bar and paging out of the viewport with it.
 */
for (const width of [1280, 1024, 390]) {
  test(`outbox: the table scrolls inside its container at ${width}px, the page does not`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/auth/login');
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.locator('main form button[type="submit"]').click();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto('/outbox');
    await expect(page.locator('#outbox-monitor-container')).toBeVisible();

    const m = await page.evaluate(() => {
      const c = document.getElementById('outbox-monitor-container') as HTMLElement;
      const box = c.querySelector('table')?.parentElement as HTMLElement | null;
      return {
        innerWidth: window.innerWidth,
        docScrollWidth: document.documentElement.scrollWidth,
        containerWidth: Math.round(c.getBoundingClientRect().width),
        containerScrollWidth: c.scrollWidth,
        box: box && {
          overflowX: getComputedStyle(box).overflowX,
          client: box.clientWidth,
          scroll: box.scrollWidth,
        },
      };
    });
    // No horizontal scrollbar on the document, and nothing spilling out of the container.
    expect(m.docScrollWidth).toBeLessThanOrEqual(m.innerWidth + 1);
    expect(m.containerScrollWidth).toBeLessThanOrEqual(m.containerWidth + 1);
    // The table's own box is the scroller, and it never grows past the container.
    expect(m.box?.overflowX).toMatch(/auto|scroll/);
    expect(m.box?.client ?? 0).toBeLessThanOrEqual(m.containerWidth + 1);
  });
}
