import { describe, expect, test } from 'bun:test';
import {
  addAppCssImport,
  addRegistryImport,
  makeSpec,
  renderManifest,
  renderTokens,
  type ThemeSpec,
  varOf,
} from './plan.ts';

const SOURCE_LAYOUTS = {
  dashboard: { default: 'sidebar-classic', wide: 'sidebar-classic', focused: 'centered-narrow' },
  public: { default: 'marketing-wide' },
  auth: { default: 'centered-card' },
} as const;

const spec = (over: Parameters<typeof makeSpec>[0]) => makeSpec(over, SOURCE_LAYOUTS);

const TOKENS = `/* Tema: base — komentar sumber yang harus hilang. */

[data-app-theme="base"] {
  --primary: #2563eb;
}

[data-app-theme="base"][data-mode="dark"],
[data-app-theme="base"] :is([data-mode="dark"]) {
  --primary: #3b82f6;
}
`;

const REGISTRY = `import iconsJson from '../icons/registry.json';
import baseTheme from '../themes/base/theme.json';
import contrastTheme from '../themes/contrast/theme.json';
import warmTheme from '../themes/warm/theme.json';
import { moduleThemes } from './generated/contrib.ts';

const themeList: ThemeManifest[] = [
  ...[baseTheme, contrastTheme, warmTheme].map((t) => ({
    ...(t as ThemeManifest),
    module: 'core',
  })),
  ...(moduleThemes as readonly ThemeManifest[]),
];
`;

const APP_CSS = `@import "tailwindcss";
@import "@core/ui-theme/themes/base/tokens.css";
@import "@core/ui-theme/themes/warm/tokens.css";
@import "./generated/themes.css";
`;

describe('makeSpec (P-11)', () => {
  test('id tema core dan turunan modul', () => {
    expect(spec({ id: 'senja' }).fullId).toBe('senja');
    expect(spec({ id: 'senja', module: 'Billing' }).fullId).toBe('billing.senja');
  });

  test('nama & deskripsi punya nilai baku yang masuk akal', () => {
    const s = spec({ id: 'mid-night' });
    expect(s.name).toEqual({ id: 'Mid night', en: 'Mid night' });
    expect(s.description.id).toContain('base');
    expect(varOf('mid-night')).toBe('midNightTheme');
  });

  test('layout sumber dipakai, override hanya menimpa yang disebut', () => {
    const s = spec({ id: 'senja', layouts: { dashboard: { default: 'topnav-compact' } } });
    expect(s.layouts.dashboard).toEqual({
      default: 'topnav-compact',
      wide: 'sidebar-classic',
      focused: 'centered-narrow',
    });
    expect(s.layouts.auth).toEqual({ default: 'centered-card' });
  });

  test('id yang tidak valid, modul yang tidak PascalCase, dan turunan dari diri sendiri ditolak', () => {
    expect(() => spec({ id: 'Senja' })).toThrow(/tidak valid/);
    expect(() => spec({ id: 'senja!' })).toThrow(/tidak valid/);
    expect(() => spec({ id: 'senja', module: 'billing' })).toThrow(/PascalCase/);
    expect(() => spec({ id: 'base', from: 'base' })).toThrow(/diturunkan dari dirinya/);
  });
});

describe('renderTokens', () => {
  test('setiap selektor tema sumber ditulis ulang ke id baru — terang dan gelap', () => {
    const css = renderTokens(TOKENS, spec({ id: 'senja' }));
    expect(css).not.toContain('[data-app-theme="base"]');
    expect(css.match(/\[data-app-theme="senja"\]/g)).toHaveLength(3);
    expect(css).toContain('[data-app-theme="senja"][data-mode="dark"]');
  });

  test('komentar tema sumber diganti, bukan ditumpuk', () => {
    const css = renderTokens(TOKENS, spec({ id: 'senja' }));
    expect(css).not.toContain('komentar sumber yang harus hilang');
    expect(css.startsWith('/* Tema: senja —')).toBe(true);
  });

  test('tema modul memakai id ber-namespace di selektornya', () => {
    const css = renderTokens(TOKENS, spec({ id: 'laut', module: 'Billing' }));
    expect(css).toContain('[data-app-theme="billing.laut"]');
  });

  test('tokens.css yang tidak memuat selektor tema sumber ditolak', () => {
    expect(() => renderTokens('/* kosong */', spec({ id: 'senja' }))).toThrow(/tidak memuat/);
  });
});

describe('renderManifest', () => {
  test('manifest memakai fullId dan tidak mengarang aset yang belum ada', () => {
    const json = JSON.parse(renderManifest(spec({ id: 'senja', module: 'Billing' }))) as Record<
      string,
      unknown
    >;
    expect(json.id).toBe('billing.senja');
    expect(json.tokens).toBe('./tokens.css');
    expect(json.assets).toBeUndefined();
    expect(json.preview).toBeUndefined();
  });
});

describe('pendaftaran tema core', () => {
  const senja: ThemeSpec = spec({ id: 'senja' });

  test('import disisipkan urut path (biome mengurutkan; lint adalah gate)', () => {
    const out = addRegistryImport(REGISTRY, senja);
    const lines = out.split('\n').filter((l) => l.includes('/theme.json'));
    expect(lines.map((l) => /themes\/([a-z-]+)\//.exec(l)?.[1])).toEqual([
      'base',
      'contrast',
      'senja',
      'warm',
    ]);
  });

  test('tema ikut masuk daftar tema bawaan', () => {
    expect(addRegistryImport(REGISTRY, senja)).toContain(
      '...[baseTheme, contrastTheme, warmTheme, senjaTheme].map',
    );
  });

  test('import sebelum yang pertama bila id-nya paling awal', () => {
    const out = addRegistryImport(REGISTRY, spec({ id: 'aurora' }));
    expect(out).toMatch(/registry\.json';\nimport auroraTheme from '\.\.\/themes\/aurora/);
  });

  test('idempoten: dijalankan dua kali tidak menggandakan apa pun', () => {
    const once = addRegistryImport(REGISTRY, senja);
    expect(addRegistryImport(once, senja)).toBe(once);
    const css = addAppCssImport(APP_CSS, senja);
    expect(addAppCssImport(css, senja)).toBe(css);
  });

  test('app.css: tokens disisipkan setelah import tema terakhir, sebelum tema modul', () => {
    const out = addAppCssImport(APP_CSS, senja);
    expect(out).toContain(
      '@import "@core/ui-theme/themes/warm/tokens.css";\n@import "@core/ui-theme/themes/senja/tokens.css";',
    );
    expect(out.indexOf('senja/tokens.css')).toBeLessThan(out.indexOf('generated/themes.css'));
  });

  test('berkas yang tidak punya jangkar ditolak dengan pesan yang menyebut berkasnya', () => {
    expect(() => addRegistryImport('const x = 1;\n', senja)).toThrow(/registry\.ts/);
    expect(() => addAppCssImport('@import "tailwindcss";\n', senja)).toThrow(/app\.css/);
  });
});
