import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  publicDir: '../web/public',
  build: { outDir: 'dist', license: { fileName: 'third-party-notices.md' } },
  server: { fs: { allow: ['../..'] } },
  // The native bundle uses packaged assets. It never registers the web PWA SW.
});
