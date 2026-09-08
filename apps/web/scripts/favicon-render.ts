/**
 * Rasterise static/favicon.svg into the PNG sizes browsers still ask for
 * (32 px tab icon, 180 px Apple touch icon, 512 px manifest/PWA). Uses the Playwright Chromium the
 * E2E suite already installs — no native image library in the repo.
 *
 *   bun run favicon:render
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const web = join(import.meta.dir, '..');
const svg = readFileSync(join(web, 'static/favicon.svg'), 'utf8');
const targets: [string, number][] = [
  ['favicon-32.png', 32],
  ['apple-touch-icon.png', 180],
  ['favicon-512.png', 512],
];
const browser = await chromium.launch();
try {
  for (const [name, size] of targets) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">${svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`)}</body></html>`,
    );
    const png = await page.screenshot({
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });
    writeFileSync(join(web, 'static', name), png);
    console.log(`${name} ${png.byteLength} B`);
    await page.close();
  }
} finally {
  await browser.close();
}
