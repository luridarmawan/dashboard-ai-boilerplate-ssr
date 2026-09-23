import { expect, test } from '@playwright/test';

/**
 * The MCP admin page's enhanced layer (I-5, L-20) in a real browser. The API side — connect,
 * discover, store, replace — is already proven by `modules/AI/test/integration/mcp-client.test.ts`;
 * what matters here is that testing a server and reloading its tools happen WITHOUT a page load.
 * Every step asserts against a marker put on `window`: a reload would wipe it, so the marker
 * surviving is the proof that the page stayed put.
 *
 * `MCP_MOCK_URL` is a real MCP server started by scripts/ci/m1-proof.sh — a fake one would prove
 * only that an error renders, never that a tool list arrives.
 */
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.test';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'bootstrap admin password';
const MCP_URL = process.env.MCP_MOCK_URL ?? 'http://127.0.0.1:4020/mcp';

declare global {
  interface Window {
    __mcpMark?: number;
  }
}

test('mcp: testing a server and reloading its tools run over fetch, not page loads', async ({
  page,
}) => {
  await page.goto('/auth/login');
  await page.fill('input[name="email"]', EMAIL);
  await page.fill('input[name="password"]', PASSWORD);
  await page.locator('main form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/dashboard/);

  // A server of our own, so the run does not depend on what the seed left behind.
  const code = `e2e-mock-${Date.now() % 100000}`;
  await page.goto('/m/ai/mcps/new');
  await page.fill('input[name="name"]', `E2E mock ${code}`);
  await page.fill('input[name="code"]', code);
  await page.fill('input[name="url"]', MCP_URL);
  await page.locator('main form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/m\/ai\/mcps\/[0-9a-f-]+\?saved=1/);

  // Never tested yet: no tools, and the button invites a first test.
  await expect(page.getByTestId('mcp-tools-count')).toContainText(/^0 tool|^0 tools/);
  await expect(page.getByTestId('mcp-test')).toContainText(/Uji & muat tool|Test & load tools/);

  const mark = Date.now();
  await page.evaluate((m) => {
    window.__mcpMark = m;
  }, mark);
  const survived = () => page.evaluate(() => window.__mcpMark);

  // Watch what the click actually does: a form POST would navigate the main frame and arrive as a
  // `document` request. The enhanced layer must produce neither — only a `fetch`.
  const navigations: string[] = [];
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) navigations.push(f.url());
  });
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') posts.push(`${r.resourceType()} ${new URL(r.url()).pathname}`);
  });

  // Test: the connection is made and the table fills in, in place.
  await page.getByTestId('mcp-test').click();
  // While it runs the button says so: disabled, labelled, and the icon spins (the mock is slow on
  // purpose, see scripts/ci/m1-proof.sh). A still icon next to "Running…" reads like a hung page.
  await expect(page.getByTestId('mcp-test')).toBeDisabled();
  await expect(page.getByTestId('mcp-test').locator('svg')).toHaveClass(/animate-spin/);
  await expect(page.getByTestId('mcp-test-ok')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('mcp-test')).toBeEnabled();
  expect(await survived()).toBe(mark);
  expect(navigations).toEqual([]);
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatch(/^fetch \/m\/ai\/mcps\/[0-9a-f-]+\/test$/);
  await expect(page.getByTestId('mcp-tool-row')).toHaveCount(2);
  await expect(page.getByTestId('mcp-tool-row').first()).toContainText('echo');
  await expect(page.locator('main').getByText('ok', { exact: true }).first()).toBeVisible();

  // Connected: the same button now offers to re-test and reload, and does so without a load.
  await expect(page.getByTestId('mcp-test')).toContainText(/Uji ulang|Re-test/);
  await page.getByTestId('mcp-test').click();
  await expect(page.getByTestId('mcp-test-ok')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('mcp-tool-row')).toHaveCount(2);
  expect(await survived()).toBe(mark);

  // The search box narrows the table as it is typed — no request, the rows are already here.
  await page.fill('[data-testid="mcp-tool-search"]', 'ping');
  await expect(page.getByTestId('mcp-tool-row')).toHaveCount(1);
  await expect(page.getByTestId('mcp-tools-count')).toContainText(/1 dari 2|1 of 2/);
  expect(await survived()).toBe(mark);
  await page.fill('[data-testid="mcp-tool-search"]', 'nothing-matches-this');
  await expect(page.getByTestId('mcp-tool-row')).toHaveCount(0);
  await expect(page.locator('tbody')).toContainText(/Tidak ada tool yang cocok|No tool matches/);
  await page.fill('[data-testid="mcp-tool-search"]', '');
  await expect(page.getByTestId('mcp-tool-row')).toHaveCount(2);
  expect(await survived()).toBe(mark);

  // Choosing tools: a checkbox saves itself the moment it changes — no save button, no load.
  // Both start enabled (the default), so the header box is fully checked.
  await expect(page.getByTestId('mcp-tools-enabled')).toContainText(/2 aktif|2 enabled/);
  await expect(page.getByTestId('mcp-tools-all')).toBeChecked();
  posts.length = 0;
  const echoRow = page.getByTestId('mcp-tool-row').filter({ hasText: 'echo' });
  await echoRow.getByTestId('mcp-tool-toggle').uncheck();
  await expect(page.getByTestId('mcp-tools-saved')).toBeVisible();
  expect(posts).toEqual([expect.stringMatching(/^fetch \/m\/ai\/mcps\/[0-9a-f-]+\/tools$/)]);
  expect(navigations).toEqual([]);
  expect(await survived()).toBe(mark);
  await expect(echoRow).toContainText(/nonaktif|disabled/);
  await expect(echoRow).toHaveAttribute('data-enabled', 'false');
  await expect(page.getByTestId('mcp-tools-enabled')).toContainText(/1 aktif|1 enabled/);
  // Mixed: the header box is neither on nor off.
  expect(
    await page
      .getByTestId('mcp-tools-all')
      .evaluate((el) => (el as HTMLInputElement).indeterminate),
  ).toBe(true);
  // The choice is what the server holds, not just what the page drew: a fresh load shows it too.
  await page.reload();
  await expect(
    page.getByTestId('mcp-tool-row').filter({ hasText: 'echo' }).getByTestId('mcp-tool-toggle'),
  ).not.toBeChecked();
  await expect(page.getByTestId('mcp-tools-enabled')).toContainText(/1 aktif|1 enabled/);
  // …and a re-test keeps it: rows are rewritten, the disabled one stays disabled.
  await page.getByTestId('mcp-test').click();
  await expect(page.getByTestId('mcp-test-ok')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('mcp-tool-row')).toHaveCount(2);
  await expect(page.getByTestId('mcp-tools-enabled')).toContainText(/1 aktif|1 enabled/);
  // Select all / deselect all from the header box, one request each. Mixed reads as unchecked
  // (plus indeterminate), so the first click of a mixed box selects ALL — the browser's own rule.
  await page.evaluate((m) => {
    window.__mcpMark = m;
  }, mark);
  posts.length = 0;
  await page.getByTestId('mcp-tools-all').check();
  await expect(page.getByTestId('mcp-tools-enabled')).toContainText(/2 aktif|2 enabled/);
  await expect(
    page.getByTestId('mcp-tool-row').filter({ hasText: /nonaktif|disabled/ }),
  ).toHaveCount(0);
  await page.getByTestId('mcp-tools-all').uncheck();
  await expect(page.getByTestId('mcp-tools-enabled')).toContainText(/0 aktif|0 enabled/);
  await expect(
    page.getByTestId('mcp-tool-row').filter({ hasText: /nonaktif|disabled/ }),
  ).toHaveCount(2);
  await page.getByTestId('mcp-tools-all').check();
  await expect(page.getByTestId('mcp-tools-enabled')).toContainText(/2 aktif|2 enabled/);
  await expect(page.getByTestId('mcp-tools-saved')).toBeVisible();
  expect(posts.filter((p) => p.endsWith('/tools'))).toHaveLength(3);
  expect(await survived()).toBe(mark);
  // With a search active, "all" means the rows shown: the hidden row is left alone.
  await page.fill('[data-testid="mcp-tool-search"]', 'ping');
  await expect(page.getByTestId('mcp-tool-row')).toHaveCount(1);
  await page.getByTestId('mcp-tools-all').uncheck();
  await expect(page.getByTestId('mcp-tools-enabled')).toContainText(/1 aktif|1 enabled/);
  await page.fill('[data-testid="mcp-tool-search"]', '');
  await expect(page.getByTestId('mcp-tool-row').filter({ hasText: 'echo' })).toHaveAttribute(
    'data-enabled',
    'true',
  );
  await page.getByTestId('mcp-tools-all').check();
  await expect(page.getByTestId('mcp-tools-enabled')).toContainText(/2 aktif|2 enabled/);
  expect(await survived()).toBe(mark);

  // A server that cannot be reached fails in place too: the error is shown, the page stays.
  await page.fill('input[name="url"]', 'http://127.0.0.1:9/mcp');
  await page.locator('form[action="?/save"] button[type="submit"]').click();
  await expect(page.locator('.notice').first()).toBeVisible();
  await page.evaluate((m) => {
    window.__mcpMark = m;
  }, mark);
  await page.getByTestId('mcp-test').click();
  await expect(page.getByTestId('mcp-test-fail')).toBeVisible({ timeout: 40_000 });
  expect(await survived()).toBe(mark);
  // A failed test does not erase what the last good one discovered.
  await expect(page.getByTestId('mcp-tool-row')).toHaveCount(2);

  // Clean up, so a re-run starts from the same place.
  await page.goto(`${page.url().split('?')[0]}?confirm=delete`);
  await page.locator('form[action="?/delete&confirm=delete"] button[type="submit"]').click();
  await expect(page).toHaveURL(/\/m\/ai\/mcps\?saved=deleted/);
});

/**
 * The same page with JavaScript off (L-22). The enhanced layer above is an addition, not a
 * replacement: the `?/test` form action must still connect, still store the tools, and still say
 * so — through a full page load, which is exactly what the layer above removes.
 */
test.describe('no JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('mcp: the test button still works as a plain form post', async ({ page }) => {
    await page.goto('/auth/login');
    await page.fill('input[name="email"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    await page.locator('main form button[type="submit"]').click();
    await expect(page).toHaveURL(/\/dashboard/);

    const code = `e2e-nojs-${Date.now() % 100000}`;
    await page.goto('/m/ai/mcps/new');
    await page.fill('input[name="name"]', `E2E no-JS ${code}`);
    await page.fill('input[name="code"]', code);
    await page.fill('input[name="url"]', MCP_URL);
    await page.locator('main form button[type="submit"]').click();
    await expect(page).toHaveURL(/\/m\/ai\/mcps\/[0-9a-f-]+\?saved=1/);

    await page.getByTestId('mcp-test').click();
    await expect(page.getByTestId('mcp-test-ok')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('mcp-tool-row')).toHaveCount(2);

    // Choosing tools is a plain form too: untick, press the <noscript> button, the page reloads
    // with the choice stored — the same API endpoint the fetch path uses.
    const echoRow = page.getByTestId('mcp-tool-row').filter({ hasText: 'echo' });
    await echoRow.getByTestId('mcp-tool-toggle').uncheck();
    await page.locator('form[action="?/tools"] button[type="submit"]').click();
    await expect(page.getByTestId('mcp-tools-saved')).toBeVisible();
    await expect(
      page.getByTestId('mcp-tool-row').filter({ hasText: 'echo' }).getByTestId('mcp-tool-toggle'),
    ).not.toBeChecked();
    await expect(page.getByTestId('mcp-tool-row').filter({ hasText: 'echo' })).toContainText(
      /nonaktif|disabled/,
    );
    await expect(page.getByTestId('mcp-tools-enabled')).toContainText(/1 aktif|1 enabled/);

    // The search box is a plain GET field: submitting reloads the page as `?q=`, already narrowed.
    const detail = page.url().split('?')[0];
    await page.goto(`${detail}?q=ping`);
    await expect(page.getByTestId('mcp-tool-row')).toHaveCount(1);
    await expect(page.locator('[data-testid="mcp-tool-search"]')).toHaveValue('ping');

    // Without JavaScript the trigger is a real link to the confirmation the server renders.
    await page.goto(`${page.url().split('?')[0]}?confirm=delete`);
    await page.locator('form[action="?/delete&confirm=delete"] button[type="submit"]').click();
    await expect(page).toHaveURL(/\/m\/ai\/mcps\?saved=deleted/);
  });
});
