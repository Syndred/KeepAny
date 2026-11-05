import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('../web/src', import.meta.url)) } },
  publicDir: '../web/public',
  build: { outDir: 'dist', target: ['chrome111', 'safari16.4', 'ios16.4'], license: { fileName: 'third-party-notices.md' } },
  server: { fs: { allow: ['../..'] } },
  // Packaged native assets do not register the Web/PWA service worker.
});
