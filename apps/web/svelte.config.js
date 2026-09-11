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
    // A-10: pemeriksaan Origin untuk request pengubah-keadaan pindah ke src/hooks.server.ts.
    // `kit.csrf` ikut terbakar ke build, sedangkan origin publik adalah nilai deploy (APP_ORIGIN,
    // Keputusan E) — image yang sudah dikirim harus menerima domainnya sendiri tanpa dibangun
    // ulang, dan di belakang proxy yang tidak meneruskan X-Forwarded-Proto/Host rekonstruksi
    // origin milik adapter-node salah sehingga semua form POST biasa ditolak. Pasangan token
    // (`_csrf` + cookie) tetap wajib di setiap action — lihat src/lib/server/origin.ts.
    // SvelteKit menandai opsi ini deprecated (penggantinya `csrf.trustedOrigins`, juga build-time,
    // dan tidak bisa mematikan perbandingan same-origin) — itu sumber peringatan saat `svelte-kit
    // sync`/build. Bila kelak benar-benar dihapus, pemeriksaan di hooks.server.ts sudah menutupi
    // A-10; yang perlu ditinjau saat itu adalah bagaimana memberi tahu SvelteKit origin publiknya.
    csrf: { checkOrigin: false },
    alias: {
      '@core/ui-theme': '../../packages/ui-theme',
      // Extension point 10: modules import core components as `@core/ui` (see src/lib/components/index.ts).
      '@core/ui': 'src/lib/components',
    },
  },
};
