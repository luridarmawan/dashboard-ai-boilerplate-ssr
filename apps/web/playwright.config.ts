import { defineConfig } from '@playwright/test';

/**
 * E2E (PRD P-8): one real-browser pass over landing → login → CRUD → chat. The stack is started by
 * scripts/ci/m1-proof.sh (API + built web + mock AI provider); this config only points at it.
 */
export default defineConfig({
  testDir: './e2e',
  // *.e2e.ts so `bun test` (which picks up *.spec.ts / *.test.ts everywhere) never loads these
  testMatch: /.*\.e2e\.ts$/,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.WEB_URL ?? 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    locale: 'id-ID',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
