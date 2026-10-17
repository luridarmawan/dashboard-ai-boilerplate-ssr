import { expect, test } from '@playwright/test';

/**
 * The Pages module's permalink form in a real browser: changing the slug of a published page goes
 * over fetch, the permalink and the list of redirecting old addresses update in place, and a
 * toast says the old URL now redirects. A marker on `window` proves nothing reloaded. The 301
 * itself is checked over plain HTTP in modules/Pages/test/web/redirects.test.ts.
 */
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.test';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'bootstrap admin password';

declare global {
  interface Window {
    __pagesMark?: number;
  }
}

test('pages: changing a permalink updates in place and announces the redirect', async ({
  page,
}) => {
  const run = Date.now();
  const first = `e2e-${run}-about-us`;
  const second = `e2e-${run}-about-our-company`;

  await page.goto('/auth/login');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.locator('main form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/);

  // A published page, created through the ordinary form.
  await page.goto('/m/pages/pages/new');
  // Fill only once hydrated: in a slow dev build, hydration would reset the select afterwards.
  await expect(page.locator('main form[data-enhanced="true"]')).toBeVisible();
  await page.fill('input[name="title"]', `About ${run}`);
  await page.fill('input[name="slug"]', first);
  await page.selectOption('select[name="status"]', 'published');
  await page.locator('main form button[type="submit"]').first().click();
  await expect(page).toHaveURL(/\/m\/pages\/pages\/[0-9a-f-]{36}/);
  await expect(page.getByTestId('pages-permalink')).toContainText(`/${first}`);
  await expect(page.getByTestId('pages-redirects-empty')).toBeVisible();

  const form = page.getByTestId('pages-permalink-form');
  await expect(form).toHaveAttribute('data-enhanced', 'true');
  const mark = Date.now();
  await page.evaluate((m) => {
    window.__pagesMark = m;
  }, mark);
  const urlBefore = page.url();

  await page.fill('#pages-slug', second);
  await form.locator('button[type="submit"]').click();

  // The toast lives in the toaster's live region (inline notices are role=status too).
  const toast = page
    .locator('[aria-live="polite"] [role="status"]')
    .filter({ hasText: `/${second}` });
  await expect(toast).toBeVisible({ timeout: 15_000 });
  await expect(toast).toContainText(`/${first}`);
  await expect(toast).toContainText('301');
  await expect(page.getByTestId('pages-permalink')).toContainText(`/${second}`);
  await expect(page.getByTestId('pages-redirects')).toContainText(`/${first}`);
  await expect(page.locator('#pages-slug')).toHaveValue(second);
  expect(page.url()).toBe(urlBefore);
  expect(await page.evaluate(() => window.__pagesMark)).toBe(mark);
});

test('pages: the body editor formats, previews like the public page, and saves', async ({
  page,
}) => {
  const run = Date.now();
  await page.goto('/auth/login');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.locator('main form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto('/m/pages/pages/new');
  const editor = page.getByTestId('pages-editor');
  await expect(editor).toHaveAttribute('data-mode', /visual|write|preview|split/);
  await editor.locator('[data-view="write"]').click();
  await page.fill('input[name="title"]', `Editor ${run}`);
  await page.fill('input[name="slug"]', `e2e-${run}-editor`);

  // The toolbar wraps the selection: type a word, select it, press Bold.
  const body = page.locator('textarea[name="body"]');
  await body.fill('# Halo\n\nkata');
  await body.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(8, 12));
  await editor.locator('[data-tool="bold"]').click();
  await expect(body).toHaveValue('# Halo\n\n**kata**');

  // Preview renders with the public page's rules: `#` becomes an <h2>, scripts never run.
  await body.fill(`${await body.inputValue()}\n\n<script>window.__x = 1</script>`);
  await editor.locator('[data-view="preview"]').click();
  const preview = page.getByTestId('pages-preview');
  await expect(preview.locator('h2')).toHaveText('Halo');
  await expect(preview.locator('strong')).toHaveText('kata');
  expect(await preview.locator('script').count()).toBe(0);
  // Hidden but still in the form: saving from the preview keeps what was typed.
  await page.locator('main form button[type="submit"]').first().click();
  await expect(page).toHaveURL(/\/m\/pages\/pages\/[0-9a-f-]{36}/);
  await expect(page.locator('textarea[name="body"]')).toHaveValue(/\*\*kata\*\*/);
});

test('pages: the visual (WYSIWYG) view edits the same Markdown the form saves', async ({
  page,
}) => {
  const run = Date.now();
  await page.goto('/auth/login');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.locator('main form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto('/m/pages/pages/new');
  const editor = page.getByTestId('pages-editor');
  // Visual is the default view for someone who never picked one.
  await expect(editor).toHaveAttribute('data-mode', 'visual');
  await page.fill('input[name="title"]', `Visual ${run}`);
  await page.fill('input[name="slug"]', `e2e-${run}-visual`);

  const visual = page.getByTestId('pages-visual');
  await expect(visual).toBeVisible({ timeout: 15_000 });
  await visual.click();
  await page.keyboard.type('Judul');
  await editor.locator('[data-tool="heading"]').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('kata ');
  await editor.locator('[data-tool="bold"]').click();
  await page.keyboard.type('tebal');
  await expect(visual.locator('h2')).toHaveText('Judul');
  await expect(visual.locator('strong')).toHaveText('tebal');

  // The hidden textarea — what the form posts — holds Markdown, not HTML.
  const body = page.locator('textarea[name="body"]');
  await expect(body).toHaveValue(/^## Judul\n\nkata \*\*tebal\*\*\s*$/);

  // The source view shows the same text; back to visual rebuilds from it.
  await editor.locator('[data-view="write"]').click();
  await expect(body).toBeVisible();
  await editor.locator('[data-view="visual"]').click();
  await expect(page.getByTestId('pages-visual').locator('strong')).toHaveText('tebal');

  await page.locator('main form button[type="submit"]').first().click();
  await expect(page).toHaveURL(/\/m\/pages\/pages\/[0-9a-f-]{36}/);
  await expect(page.getByTestId('pages-visual').locator('h2')).toHaveText('Judul', {
    timeout: 15_000,
  });
  await expect(page.locator('textarea[name="body"]')).toHaveValue(/\*\*tebal\*\*/);
});
