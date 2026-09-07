import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALL_TOKENS,
  checkContrast,
  contrastRatio,
  customManifest,
  parseTokensCss,
  resolveTheme,
  tokensToCss,
} from '../src/index.ts';

const baseCss = readFileSync(join(import.meta.dir, '../themes/base/tokens.css'), 'utf8');

describe('custom themes (L-24): tokens ↔ CSS, contrast (L-21), resolution', () => {
  test('the built-in base theme round-trips and passes AA in both modes', () => {
    const tokens = parseTokensCss(baseCss);
    for (const name of ALL_TOKENS) expect(tokens.light[name], name).toBeDefined();
    expect(tokens.dark.background).toBe('#0b1220');
    expect(checkContrast(tokens)).toEqual([]);
    const css = tokensToCss('custom.copy', tokens);
    expect(css).toContain('[data-app-theme="custom.copy"] {');
    expect(css).toContain('[data-app-theme="custom.copy"][data-mode="dark"]');
    const again = parseTokensCss(css);
    expect(again.light.primary).toBe(tokens.light.primary);
    expect(again.dark.primary).toBe(tokens.dark.primary);
  });

  test('a low-contrast pair is reported with its ratio; a missing token fails too', () => {
    const tokens = parseTokensCss(baseCss);
    const bad = { light: { ...tokens.light, foreground: '#dddddd' }, dark: tokens.dark };
    const problems = checkContrast(bad);
    expect(
      problems.some((p) => p.mode === 'light' && p.fg === 'foreground' && p.bg === 'background'),
    ).toBe(true);
    expect(problems.every((p) => p.mode === 'light')).toBe(true); // dark overrides foreground itself
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
    const { primary: _drop, ...light } = tokens.light;
    void _drop;
    const missing = checkContrast({ light, dark: tokens.dark });
    expect(missing.some((p) => p.message.includes('--primary') && p.ratio === null)).toBe(true);
  });

  test('token values cannot smuggle CSS; ids cannot break out of the selector', () => {
    const css = tokensToCss('custom.x"] body{color:red}[x="', {
      light: { primary: '#ffffff; } body { display:none' },
      dark: {},
    });
    // Braces and semicolons are gone from values, so nothing can close the block or start a rule;
    // the id keeps only [a-zA-Z0-9._-], so nothing can escape the attribute selector.
    expect(css).not.toMatch(/;\s*}\s*body/);
    expect(css).not.toContain('body{color:red}');
    expect(css.startsWith('[data-app-theme="custom.xbodycolorredx"] {')).toBe(true);
    expect(css.match(/\{/g)?.length).toBe(2);
    expect(css.match(/\}/g)?.length).toBe(2);
  });

  test('resolveTheme accepts runtime themes via `extra` and still falls back sanely', () => {
    const custom = customManifest({
      code: 'custom.night',
      name: { id: 'Malam', en: 'Night' },
      description: null,
      icons: 'outline-24',
      layouts: { dashboard: { default: 'sidebar-classic' } },
      tokens: { light: {}, dark: {} },
    });
    expect(resolveTheme({ user: 'custom.night', extra: [custom] }).theme.id).toBe('custom.night');
    expect(resolveTheme({ user: 'custom.night' }).theme.id).toBe('base'); // unknown without extra
    expect(
      resolveTheme({ user: 'custom.night', extra: [custom], allowed: ['base'] }).theme.id,
    ).toBe('base');
    expect(custom.custom).toBe(true);
  });
});
