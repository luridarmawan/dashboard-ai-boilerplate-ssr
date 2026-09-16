import { expect, test } from '@playwright/test';

/**
 * The contact form on the Example landing (R-5, L-20 over L-22). The HTTP proofs cover the base
 * layer — a plain POST to the page's form action, which still answers with the confirmation when
 * JavaScript is off (scripts/m4-gate-proof.ts #3). What a real browser has to show is the
 * ENHANCED layer: the same action taken over fetch, with the document never left behind.
 *
 * A marker on `window` is the proof — a conventional form POST would wipe it — and the request
 * log is the second half: the only POST must be of resourceType `fetch`, not `document`.
 */
declare global {
  interface Window {
    __contactMark?: number;
  }
}

test('contact: terkirim lewat fetch, tanpa muat ulang halaman', async ({ page }) => {
  const posts: { path: string; kind: string }[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST')
      posts.push({ path: new URL(r.url()).pathname, kind: r.resourceType() });
  });

  await page.goto('/example#contact');
  // `data-enhanced` appears on mount: a click before that posts the form the ordinary way, which
  // is correct behaviour but not what this test is about.
  await expect(page.getByTestId('contact-form')).toHaveAttribute('data-enhanced', 'true');
  const mark = Date.now();
  await page.evaluate((m) => {
    window.__contactMark = m;
  }, mark);
  const survived = () => page.evaluate(() => window.__contactMark);

  await page.fill('input[name="name"]', 'Pengunjung E2E');
  await page.fill('input[name="email"]', `e2e-${Date.now()}@example.test`);
  await page.fill(
    'textarea[name="message"]',
    'Halo, saya ingin memesan 10 kg untuk kantor kami. Terima kasih.',
  );
  await page.getByTestId('contact-send').click();

  await expect(page.getByTestId('contact-sent')).toBeVisible({ timeout: 15_000 });
  // The document that submitted is the document still running, and the submit went out as a
  // fetch: `document` here would mean the browser posted the form the ordinary way.
  expect(await survived()).toBe(mark);
  expect(posts.map((p) => p.kind)).toEqual(['fetch']);
  expect(posts[0]?.path).toBe('/example');

  // "Send another" puts the form back — again without leaving the page.
  await page.getByTestId('contact-sent').getByRole('link').click();
  await expect(page.getByTestId('contact-send')).toBeVisible();
  expect(await survived()).toBe(mark);
  // The fields come back empty: the previous message was sent, not kept as a draft.
  await expect(page.locator('input[name="name"]')).toHaveValue('');
});

/**
 * The same form with JavaScript off (L-22). The enhanced layer above is an addition, not a
 * replacement: the form action must still store the inquiry and still say so — through a full
 * page load, which is exactly what the layer above removes.
 */
test.describe('no JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('contact: form action biasa tetap mengirim dan menampilkan konfirmasi', async ({ page }) => {
    await page.goto('/example#contact');
    await page.fill('input[name="name"]', 'Pengunjung tanpa JS');
    await page.fill('input[name="email"]', `e2e-nojs-${Date.now()}@example.test`);
    await page.fill(
      'textarea[name="message"]',
      'Tanpa JavaScript pun formulir ini harus tetap bekerja.',
    );
    await page.getByTestId('contact-send').click();
    await expect(page.getByTestId('contact-sent')).toBeVisible({ timeout: 15_000 });
  });
});
