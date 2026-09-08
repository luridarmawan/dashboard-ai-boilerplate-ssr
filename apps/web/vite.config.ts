import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Dev-server address comes from the repo-root .env (WEB_HOST / WEB_PORT) so it can be changed
  // without editing this file. Bun only auto-loads .env from the cwd, so when Vite is started from
  // apps/web the root file is read here explicitly; shell variables still win over the file.
  const root = loadEnv(mode, '../..', '');
  const env = { ...root, ...process.env };
  return {
    plugins: [tailwindcss(), sveltekit()],
    server: {
      port: Number(env.WEB_PORT ?? 5173),
      strictPort: true,
      host: env.WEB_HOST ?? '127.0.0.1',
      // Module pages are shimmed from modules/<Name>/web/routes — outside the web root.
      fs: { allow: ['../..'] },
      // Same-origin API surface in development, exactly what Caddy does in production (Decision E):
      // browser-facing URLs such as /v1/files/<id>/content (avatars, theme logos), /docs and
      // /openapi.json resolve on the web origin instead of 404-ing on the dev server.
      proxy: Object.fromEntries(
        ['/v1', '/docs', '/openapi.json'].map((path) => [
          path,
          {
            target: env.API_URL ?? `http://127.0.0.1:${env.API_PORT ?? 3001}`,
            changeOrigin: false,
          },
        ]),
      ),
    },
    preview: { port: 4173, strictPort: true },
  };
});
