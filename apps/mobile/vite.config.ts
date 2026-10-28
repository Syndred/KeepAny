import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { pdfWorkerOptions } from '../web/pdf-worker-options';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('../web/src', import.meta.url)) } },
  publicDir: '../web/public',
  worker: pdfWorkerOptions,
  build: { outDir: 'dist', license: { fileName: 'third-party-notices.md' } },
  server: { fs: { allow: ['../..'] } },
  // The native bundle uses packaged assets. It never registers the web PWA SW.
});
