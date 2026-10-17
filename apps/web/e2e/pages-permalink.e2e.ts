import { expect, test } from '@playwright/test';
import { makePng } from '../../../modules/Pages/test/fixtures/png.ts';

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

test('pages: Notion-like visual editing — slash menu, selection toolbar, block handle', async ({
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
  await expect(editor).toHaveAttribute('data-mode', /./);
  await editor.locator('[data-view="visual"]').click();
  const visual = page.getByTestId('pages-visual');
  await expect(visual).toBeVisible({ timeout: 15_000 });
  const body = page.locator('textarea[name="body"]');
  const slash = page.getByTestId('pages-slash');

  // `/` at the start of a line opens the block menu; typing filters it; Enter inserts.
  await visual.click();
  await page.keyboard.type('Pembuka');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/sub');
  await expect(slash).toHaveAttribute('data-show', 'true');
  await expect(slash.locator('[data-block="h2"]')).toBeVisible();
  await expect(slash.locator('[data-block="table"]')).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(slash).toHaveAttribute('data-show', 'false');
  await page.keyboard.type('Bagian');
  await expect(visual.locator('h2')).toHaveText('Bagian');
  await expect(body).toHaveValue(/^Pembuka\n\n## Bagian\s*$/);

  // Escape closes the menu and leaves the `/` as plain text.
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await expect(slash).toHaveAttribute('data-show', 'true');
  await page.keyboard.press('Escape');
  await expect(slash).toHaveAttribute('data-show', 'false');
  await page.keyboard.press('Backspace');

  // Selecting text shows the selection toolbar; Bold applies to the selection.
  // (Selected with the keyboard: a double click lands on the empty end of a wide paragraph.)
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+End');
  const bar = page.getByTestId('pages-selection-bar');
  await expect(bar).toHaveAttribute('data-show', 'true');
  await bar.locator('[data-mark="bold"]').click();
  await expect(visual.locator('strong')).toHaveText('Pembuka');

  // The block handle: hover a block, `+` adds one below with the menu open; click a block type.
  await visual.locator('h2').hover();
  const handle = page.getByTestId('pages-block-handle');
  await expect(handle).toHaveAttribute('data-show', 'true');
  await page.getByTestId('pages-block-add').click();
  await expect(slash).toHaveAttribute('data-show', 'true');
  await slash.locator('[data-block="quote"]').click();
  await page.keyboard.type('Kutipan penutup');
  await expect(visual.locator('blockquote')).toHaveText('Kutipan penutup');

  // Drag the quote's handle above the first paragraph: blocks reorder.
  await visual.locator('blockquote').hover();
  await expect(handle).toHaveAttribute('data-show', 'true');
  const grip = await handle.boundingBox();
  const first = await visual.locator('p').first().boundingBox();
  if (!grip || !first) throw new Error('handle or first block has no box');
  // A real drag, step by step: native drag-and-drop needs the intermediate moves.
  await page.mouse.move(grip.x + grip.width - 6, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + 20, first.y + 6, { steps: 12 });
  await page.mouse.move(first.x + 24, first.y + 3, { steps: 4 });
  await page.mouse.up();
  // Dropped on the first block's top edge: it lands right before or right after it — either way
  // the quote is no longer last, which is the move.
  await expect(body).toHaveValue(
    /^(> Kutipan penutup\n\n\*\*Pembuka\*\*|\*\*Pembuka\*\*\n\n> Kutipan penutup)\n\n## Bagian\s*$/,
  );

  await page.fill('input[name="title"]', `Notion ${run}`);
  await page.fill('input[name="slug"]', `e2e-${run}-notion`);
  await page.locator('main form button[type="submit"]').first().click();
  await expect(page).toHaveURL(/\/m\/pages\/pages\/[0-9a-f-]{36}/);
  await expect(page.locator('textarea[name="body"]')).toHaveValue(/## Bagian/);
});

test('pages: the featured image uploads over fetch and becomes the share card', async ({
  page,
}) => {
  const run = Date.now();
  await page.goto('/auth/login');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.locator('main form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto('/m/pages/pages/new');
  await expect(page.locator('main form[data-enhanced="true"]')).toBeVisible();
  await page.fill('input[name="title"]', `Gambar ${run}`);
  await page.fill('input[name="slug"]', `e2e-${run}-image`);
  await page.locator('main form button[type="submit"]').first().click();
  await expect(page).toHaveURL(/\/m\/pages\/pages\/[0-9a-f-]{36}/);

  const form = page.getByTestId('pages-image-form');
  await expect(form).toHaveAttribute('data-enhanced', 'true');
  await expect(page.getByTestId('pages-image-empty')).toBeVisible();
  // No image of its own yet: the share preview shows the site's default image, and says so.
  await expect(page.getByTestId('pages-share-default')).toBeVisible();
  await expect(page.getByTestId('pages-share-preview').locator('img')).toHaveAttribute(
    'src',
    '/og-image.jpg',
  );
  const mark = Date.now();
  await page.evaluate((m) => {
    (window as unknown as { __imgMark: number }).__imgMark = m;
  }, mark);

  // Picking a file previews it at once, with its size — before anything is uploaded.
  await page.setInputFiles('#pages-image-file', {
    name: 'hero.png',
    mimeType: 'image/png',
    buffer: Buffer.from(makePng(1200, 630)),
  });
  await expect(page.getByTestId('pages-image-size')).toHaveText('1200 × 630 px');
  await page.fill('#pages-image-alt', 'Kantor kami');
  await form.locator('button[type="submit"]').first().click();

  const toast = page
    .locator('[aria-live="polite"] [role="status"]')
    .filter({ hasText: /Gambar unggulan disimpan|Featured image saved/ });
  await expect(toast).toBeVisible({ timeout: 15_000 });
  const current = page.getByTestId('pages-image-current').locator('img');
  await expect(current).toHaveAttribute('src', /\/v1\/files\/[0-9a-f-]{36}\/content/);
  await expect(page.getByTestId('pages-share-preview').locator('img')).toHaveAttribute(
    'src',
    /\/v1\/files\//,
  );
  await expect(page.getByTestId('pages-share-default')).toHaveCount(0);
  await expect(page.locator('#pages-image-alt')).toHaveValue('Kantor kami');
  expect(await page.evaluate(() => (window as unknown as { __imgMark: number }).__imgMark)).toBe(
    mark,
  );

  // Removing it brings the empty state back, still without a reload.
  await page.getByTestId('pages-image-remove').click();
  await expect(page.getByTestId('pages-image-empty')).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => (window as unknown as { __imgMark: number }).__imgMark)).toBe(
    mark,
  );
});
