#!/usr/bin/env node
/**
 * Built-in theme validator. Runs in CI and as part of `modules:sync`.
 * Enforces three PRD requirements at once:
 *
 *   L-5  the icon set a theme references must be registered
 *   L-8  the layouts a theme references must be registered and match their kind
 *   L-21 WCAG AA contrast on EVERY theme, light and dark
 *
 * Exits with code 1 on any failure so CI rejects the merge.
 * Usage: node packages/ui-theme/validate.mjs
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const THEMES = join(root, 'themes');

/* ---------- colour & contrast (WCAG 2.1) ---------- */
const toRgb = (h) => {
  h = h.trim().replace('#', '');
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
};
const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
  const [r, g, b] = toRgb(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const l1 = luminance(a),
    l2 = luminance(b);
  const hi = Math.max(l1, l2),
    lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * Pairs that must be checked, with their thresholds.
 * 4.5 = normal text (WCAG 1.4.3). 3.0 = non-text UI components (WCAG 1.4.11).
 * `--border` is deliberately NOT checked: it is decorative (separators, card
 * outlines), not a control boundary. Form-control boundaries are marked by `--input`.
 */
const PAIRS = [
  ['foreground', 'background', 4.5],
  ['card-foreground', 'card', 4.5],
  ['popover-foreground', 'popover', 4.5],
  ['muted-foreground', 'background', 4.5],
  ['muted-foreground', 'muted', 4.5],
  ['foreground', 'muted', 4.5],
  ['primary-foreground', 'primary', 4.5],
  ['secondary-foreground', 'secondary', 4.5],
  ['accent-foreground', 'accent', 4.5],
  ['destructive-foreground', 'destructive', 4.5],
  ['destructive', 'background', 4.5],
  ['success', 'background', 4.5],
  ['warning', 'background', 4.5],
  ['primary', 'background', 4.5],
  ['input', 'background', 3.0],
  ['ring', 'background', 3.0],
];

/* ---------- reading tokens from CSS ---------- */
/** First block = light; the block whose selector contains data-mode='dark' = dark. */
function readTokens(cssPath) {
  const css = readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const light = {},
    dark = {};
  for (const [, selector, body] of blocks) {
    const target = /data-mode=['"]dark['"]/.test(selector) ? dark : light;
    for (const [, name, value] of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
      target[name] = value.trim();
    }
  }
  return { light, dark: { ...light, ...dark } }; // dark inherits whatever it does not override
}

/* ---------- load registries ---------- */
const iconRegistry = JSON.parse(readFileSync(join(root, 'icons/registry.json'), 'utf8'));
const layoutRegistry = JSON.parse(readFileSync(join(root, 'layouts/registry.json'), 'utf8'));
const layoutById = new Map(layoutRegistry.layouts.map((l) => [l.id, l]));
const knownIconSets = new Set(Object.keys(iconRegistry.sets));

/* ---------- run ---------- */
const problems = [];
const rows = [];
const themeDirs = readdirSync(THEMES, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

if (themeDirs.length < 4) {
  problems.push(`L-3: butuh minimal 4 tema bawaan, ditemukan ${themeDirs.length}`);
}

const layoutsUsed = new Set();
const iconSetsUsed = new Set();

for (const id of themeDirs) {
  const dir = join(THEMES, id);
  const manifestPath = join(dir, 'theme.json');
  if (!existsSync(manifestPath)) {
    problems.push(`${id}: theme.json tidak ada`);
    continue;
  }

  const theme = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (theme.id !== id) problems.push(`${id}: field id "${theme.id}" tidak cocok nama folder`);

  // L-5 — icon set is registered
  if (!knownIconSets.has(theme.icons)) {
    problems.push(`${id}: set ikon "${theme.icons}" tidak terdaftar di icons/registry.json (L-5)`);
  } else {
    iconSetsUsed.add(theme.icons);
  }

  // L-8 — layouts are registered and their kind matches
  for (const [kind, variants] of Object.entries(theme.layouts ?? {})) {
    if (!layoutRegistry.regions[kind]) {
      problems.push(`${id}: jenis shell "${kind}" tidak dikenal`);
      continue;
    }
    if (!variants.default) problems.push(`${id}/${kind}: varian "default" wajib ada (Keputusan K)`);
    for (const [variant, layoutId] of Object.entries(variants)) {
      const layout = layoutById.get(layoutId);
      if (!layout) {
        problems.push(`${id}/${kind}/${variant}: layout "${layoutId}" tidak terdaftar (L-8)`);
      } else if (layout.kind !== kind) {
        problems.push(
          `${id}/${kind}/${variant}: layout "${layoutId}" ber-kind "${layout.kind}" (L-8)`,
        );
      } else {
        layoutsUsed.add(layoutId);
      }
    }
  }

  // L-21 — contrast, both modes
  const tokensPath = join(dir, theme.tokens.replace(/^\.\//, ''));
  if (!existsSync(tokensPath)) {
    problems.push(`${id}: berkas token ${theme.tokens} tidak ada`);
    continue;
  }
  const modes = readTokens(tokensPath);

  for (const [mode, tokens] of Object.entries(modes)) {
    let lowest = Infinity;
    for (const [fg, bg, min] of PAIRS) {
      const fgv = tokens[fg],
        bgv = tokens[bg];
      if (!fgv || !bgv) {
        problems.push(`${id}/${mode}: token --${!fgv ? fg : bg} tidak terdefinisi`);
        continue;
      }
      if (!/^#[0-9a-f]{3,8}$/i.test(fgv) || !/^#[0-9a-f]{3,8}$/i.test(bgv)) continue;
      const r = contrast(fgv, bgv);
      lowest = Math.min(lowest, r);
      if (r < min) {
        problems.push(
          `${id}/${mode}: --${fg} pada --${bg} = ${r.toFixed(2)}, minimum ${min} (L-21)  [${fgv} / ${bgv}]`,
        );
      }
    }
    rows.push({ theme: id, mode, lowest });
  }
}

// L-3 — themes must genuinely differ in character, not just palette
if (layoutsUsed.size < 2)
  problems.push(
    `L-3: tema bawaan hanya memakai ${layoutsUsed.size} layout dashboard; minimal 2 harus berbeda`,
  );
if (iconSetsUsed.size < 2)
  problems.push(
    `L-3: tema bawaan hanya memakai ${iconSetsUsed.size} set ikon; minimal 2 harus berbeda`,
  );

/* ---------- report ---------- */
console.log(`\nTema diperiksa: ${themeDirs.join(', ')}`);
console.log(`Layout dipakai: ${[...layoutsUsed].join(', ')}`);
console.log(`Set ikon dipakai: ${[...iconSetsUsed].join(', ')}\n`);
console.log('Rasio kontras terendah per tema/mode:');
for (const r of rows) {
  console.log(`  ${`${r.theme}/${r.mode}`.padEnd(20)} ${r.lowest.toFixed(2)}`);
}

if (problems.length) {
  console.error(`\n${problems.length} MASALAH:\n${problems.map((p) => `  !! ${p}`).join('\n')}\n`);
  process.exit(1);
}
console.log('\nSemua tema lolos: set ikon & layout terdaftar, kontras WCAG AA terpenuhi.\n');
