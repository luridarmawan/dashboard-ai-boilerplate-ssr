import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    // adapter-node run under Bun: the safe fallback the PRD names (§10) — no community adapter.
    adapter: adapter({ out: 'build' }),
    alias: { '@core/ui-theme': '../../packages/ui-theme' },
  },
};
