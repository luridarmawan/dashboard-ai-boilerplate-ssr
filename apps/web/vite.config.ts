import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';
import rootPkg from '../../package.json' with { type: 'json' };

export default defineConfig(({ mode }) => {
  // Dev-server address comes from the repo-root .env (WEB_HOST / WEB_PORT) so it can be changed
  // without editing this file. Bun only auto-loads .env from the cwd, so when Vite is started from
  // apps/web the root file is read here explicitly; shell variables still win over the file.
  const root = loadEnv(mode, '../..', '');
  const env = { ...root, ...process.env };
  return {
    plugins: [tailwindcss(), sveltekit()],
    // Product version shown in the dashboard footer: the root package.json, the same source as
    // the API's /v1/version, inlined at build time.
    define: { __APP_VERSION__: JSON.stringify(rootPkg.version) },
    server: {
      port: Number(env.WEB_PORT ?? 5173),
      strictPort: true,
      host: env.WEB_HOST ?? '127.0.0.1',
      // Vite rejects unknown Host headers (DNS-rebinding guard). A dev server reached through a
      // public domain (reverse proxy, tunnel) needs that host listed: every host in APP_ORIGIN is
      // allowed, so the public origin is configured in one place.
      allowedHosts: allowedHosts(env.APP_ORIGIN),
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
            // Append the socket address to X-Forwarded-For (and keep the proxy's own entries),
            // so the API sees the visitor's IP on browser-direct calls too.
            xfwd: true,
          },
        ]),
      ),
    },
    preview: { port: 4173, strictPort: true, allowedHosts: allowedHosts(env.APP_ORIGIN) },
  };
});

/** Hostnames of the comma-separated APP_ORIGIN entries (full origins or bare hosts). */
function allowedHosts(raw: string | undefined): string[] {
  const hosts = new Set<string>();
  for (const entry of (raw ?? '').split(',')) {
    const e = entry.trim();
    if (!e) continue;
    try {
      hosts.add(new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(e) ? e : `http://${e}`).hostname);
    } catch {
      /* skip invalid entry */
    }
  }
  return [...hosts];
}
