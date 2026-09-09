import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    // adapter-node run under Bun: the safe fallback the PRD names (§10) — no community adapter.
    // precompress: immutable client assets are also emitted as .gz/.br and served as such when the
    // browser accepts it — Caddy compresses in the compose stack, this covers systemd mode and CI.
    adapter: adapter({ out: 'build', precompress: true }),
    alias: {
      '@core/ui-theme': '../../packages/ui-theme',
      // Extension point 10: modules import core components as `@core/ui` (see src/lib/components/index.ts).
      '@core/ui': 'src/lib/components',
    },
  },
};
