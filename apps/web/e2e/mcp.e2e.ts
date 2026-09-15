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

  // Test: the connection is made and the table fills in, in place.
  await page.getByTestId('mcp-test').click();
  await expect(page.getByTestId('mcp-test-ok')).toBeVisible({ timeout: 30_000 });
  expect(await survived()).toBe(mark);
  await expect(page.getByTestId('mcp-tool-row')).toHaveCount(2);
  await expect(page.getByTestId('mcp-tool-row').first()).toContainText('echo');
  await expect(page.locator('main').getByText('ok', { exact: true }).first()).toBeVisible();

  // Connected: the same button now offers to re-test and reload, and does so without a load.
  await expect(page.getByTestId('mcp-test')).toContainText(/Uji ulang|Re-test/);
  await page.getByTestId('mcp-test').click();
  await expect(page.getByTestId('mcp-test-ok')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('mcp-tool-row')).toHaveCount(2);
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

    // Without JavaScript the trigger is a real link to the confirmation the server renders.
    await page.goto(`${page.url().split('?')[0]}?confirm=delete`);
    await page.locator('form[action="?/delete&confirm=delete"] button[type="submit"]').click();
    await expect(page).toHaveURL(/\/m\/ai\/mcps\?saved=deleted/);
  });
});
