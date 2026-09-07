/**
 * Design-review screenshots + overflow report. For each viewport: open the page, report
 * innerWidth vs document scrollWidth and any element wider than the viewport (the usual cause of a
 * "zoomed out" mobile layout), then save a full-page PNG. Run inside the Playwright image by
 * scripts/ci/m1-proof.sh when PROOF_ONLY includes SHOT (lives in apps/web so @playwright/test resolves).
 *
 *   WEB_URL=http://127.0.0.1:5173 OUT=../../.proof-logs/shots bun run e2e/shots.ts /example /product/gayo-arabika
 */
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const WEB = (process.env.WEB_URL ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
const OUT = process.env.OUT ?? '.proof-logs/shots';
const paths = process.argv.slice(2).length ? process.argv.slice(2) : ['/example'];
const viewports = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
let overflowing = 0;
for (const v of viewports) {
  // Deliberately NOT isMobile: a mobile viewport silently widens to fit overflowing content (the
  // page looks "zoomed out"), which hides the culprit. A plain narrow window keeps innerWidth fixed
  // so scrollWidth > innerWidth and the offending elements can be listed.
  const ctx = await browser.newContext({
    viewport: { width: v.width, height: v.height },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  for (const p of paths) {
    await page.goto(`${WEB}${p}`, { waitUntil: 'networkidle' });
    const report = await page.evaluate(() => {
      const iw = window.innerWidth;
      const sw = document.documentElement.scrollWidth;
      const wide: string[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
        const r = el.getBoundingClientRect();
        if (r.right > iw + 1 && r.width > 0 && getComputedStyle(el).position !== 'absolute') {
          const cls = (el.getAttribute('class') ?? '').slice(0, 80);
          wide.push(`${el.tagName.toLowerCase()}.${cls} → right ${Math.round(r.right)}`);
        }
        if (wide.length >= 8) break;
      }
      return { iw, sw, wide };
    });
    const slug = p.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root';
    const file = `${OUT}/${slug}-${v.name}.png`;
    await page.screenshot({ path: file, fullPage: true });
    const ok = report.sw <= report.iw + 1;
    if (!ok) overflowing++;
    console.log(
      `${ok ? '  ✓' : '  ✗'} ${p} @${v.width}: innerWidth ${report.iw}, scrollWidth ${report.sw} → ${file}`,
    );
    for (const w of report.wide) console.log(`      overflow: ${w}`);
  }
  await ctx.close();
}
await browser.close();
if (overflowing) {
  console.log(
    `shots: ${overflowing} halaman meluap melebar (scroll horizontal) — periksa elemen di atas`,
  );
  process.exit(1);
}
