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
    // `trustedOrigins: ['*']` adalah cara yang tidak deprecated untuk mematikan pemeriksaan bawaan
    // itu (`checkOrigin: false` memicu peringatan sejak SvelteKit 2.70 dan akan dihapus). Mendaftar
    // origin satu per satu bukan pilihan: daftarnya build-time, sedangkan APP_ORIGIN baru diketahui
    // saat deploy. Bila kelak `'*'` ikut hilang, pemeriksaan di hooks.server.ts sudah menutupi A-10.
    csrf: { trustedOrigins: ['*'] },
    alias: {
      '@core/ui-theme': '../../packages/ui-theme',
      // Extension point 10: modules import core components as `@core/ui` (see src/lib/components/index.ts).
      '@core/ui': 'src/lib/components',
    },
  },
};
