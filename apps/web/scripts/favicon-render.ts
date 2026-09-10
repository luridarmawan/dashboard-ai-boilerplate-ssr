/**
 * Rasterise static/favicon.svg into the PNG sizes browsers still ask for
 * (32 px tab icon, 180 px Apple touch icon, 512 px manifest/PWA), plus favicon.ico. Uses the
 * Playwright Chromium the E2E suite already installs — no native image library in the repo.
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
/**
 * Wrap one PNG in an .ico container (the Vista-era PNG payload, understood by every browser that
 * still asks for it). `<link rel="icon">` in +layout.svelte covers the app's own pages; /favicon.ico
 * is the fallback a page WITHOUT those links requests — the Swagger page at /docs, Safari, crawlers.
 * In single-port mode (`bun start`) that request lands on web and logged a 404; this answers it.
 * One 32 px entry is enough: browsers downscale it to the 16 px tab themselves.
 */
function ico(png: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(22 + png.byteLength);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // type: icon
  view.setUint16(4, 1, true); // one image in the directory
  out[6] = size; // width  — 0 would mean 256
  out[7] = size; // height
  view.setUint16(8, 0, true); // palette size + reserved: none, it is a PNG
  view.setUint16(10, 1, true); // colour planes
  view.setUint16(12, 32, true); // bits per pixel (RGBA)
  view.setUint32(14, png.byteLength, true);
  view.setUint32(18, 22, true); // payload starts right after this 22-byte header
  out.set(png, 22);
  return out;
}

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
    if (size === 32) {
      const bytes = ico(png, size);
      writeFileSync(join(web, 'static', 'favicon.ico'), bytes);
      console.log(`favicon.ico ${bytes.byteLength} B`);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
