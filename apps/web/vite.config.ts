import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    // Module pages are shimmed from modules/<Name>/web/routes — outside the web root.
    fs: { allow: ['../..'] },
  },
  preview: { port: 4173, strictPort: true },
});
