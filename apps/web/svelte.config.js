import { readFileSync } from 'node:fs';
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * Repo-relative directories of the modules listed in modules.json, resolved the way
 * `resolveModuleDir` in packages/module-kit/src/sync.ts does (`path`, else `modules/<name>`).
 * Without a readable modules.json every folder under modules/ counts, as before.
 */
function registeredModuleDirs() {
  try {
    const file = JSON.parse(readFileSync(new URL('../../modules.json', import.meta.url), 'utf8'));
    return file.modules
      .filter((m) => m.source !== 'package')
      .map((m) => (m.path ?? `modules/${m.name}`).replace(/\/+$/, ''));
  } catch {
    return ['modules/*'];
  }
}

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    // adapter-node run under Bun: the safe fallback the PRD names (§10) — no community adapter.
    // precompress: immutable client assets are also emitted as .gz/.br and served as such when the
    // browser accepts it — Caddy compresses in the compose stack, this covers systemd mode and CI.
    adapter: adapter({ out: 'build', precompress: true }),
    // A-10: pemeriksaan Origin untuk request pengubah-keadaan pindah ke src/hooks.server.ts.
    // `kit.csrf` ikut terbakar ke build, sedangkan origin publik adalah nilai deploy (APP_ORIGIN,
    // Keputusan E) — image yang sudah dikirim harus menerima domainnya sendiri tanpa dibangun
    // ulang, dan di belakang proxy yang tidak meneruskan X-Forwarded-Proto/Host rekonstruksi
    // origin milik adapter-node salah sehingga semua form POST biasa ditolak. Pasangan token
    // (`_csrf` + cookie) tetap wajib di setiap action — lihat src/lib/server/origin.ts.
    // `trustedOrigins: ['*']` adalah cara yang tidak deprecated untuk mematikan pemeriksaan bawaan
    // itu (`checkOrigin: false` memicu peringatan sejak SvelteKit 2.70 dan akan dihapus). Mendaftar
    // origin satu per satu bukan pilihan: daftarnya build-time, sedangkan APP_ORIGIN baru diketahui
    // saat deploy. Bila kelak `'*'` ikut hilang, pemeriksaan di hooks.server.ts sudah menutupi A-10.
    csrf: { trustedOrigins: ['*'] },
    // F-11: pages are served under URLs that are not their own — `/` shows the landing route,
    // `/food/nasi-goreng` shows the module's 404 handler. SvelteKit's default relative asset
    // links (`./_app/…`) resolve against the VISITOR's URL and break as soon as that URL has
    // more segments than the page's own path (`/food/_app/…` → 404, unstyled page). The app
    // always lives at the origin root, so absolute links cost nothing and are right everywhere.
    paths: { relative: false },
    alias: {
      '@core/ui-theme': '../../packages/ui-theme',
      // Extension point 10: modules import core components as `@core/ui` (see src/lib/components/index.ts).
      '@core/ui': 'src/lib/components',
    },
    typescript: {
      /**
       * Module pages live OUTSIDE this app (`modules/<Name>/web/**`); what sits in `src/routes` is
       * a generated shim that only re-exports them (extension points 3, 10, 13). SvelteKit's
       * tsconfig therefore includes `src/**` alone, and `svelte-check` diagnoses what the tsconfig
       * includes — so a module's own pages were type-checked by nobody: not by the module's `tsc`
       * (its tsconfig excludes `web/**`, because `$lib` and `@core/ui` are aliases of THIS app),
       * and not here. A wrong i18n key or a renamed prop in a module page reached the browser.
       *
       * Adding the sources closes that: the same `bun run typecheck` that guards core pages now
       * guards module pages, here and in `bun run harness --web` inside a module's own repository.
       * Paths are relative to `kit.outDir` (`apps/web/.svelte-kit`), hence `../../..`.
       *
       * Only modules REGISTERED in modules.json are included: a module folder left on disk but
       * removed from modules.json has no generated i18n keys or registry entries, so checking it
       * reports errors for code the app does not build (gate M5 #4 removes AI exactly this way).
       */
      config(config) {
        for (const dir of registeredModuleDirs()) {
          for (const ext of ['ts', 'svelte']) {
            config.include.push(`../../../${dir}/web/**/*.${ext}`);
          }
          config.exclude.push(`../../../${dir}/node_modules/**`);
        }
        return config;
      },
    },
  },
};
