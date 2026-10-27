import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { createUrlMetadataMiddleware } from '../../scripts/intake-url-metadata.mjs';
import { pdfWorkerOptions } from './pdf-worker-options';
const selfHostProxy = process.env.KEEPANY_SELFHOST_DEV_PROXY_TARGET;
if (selfHostProxy) {
  const target = new URL(selfHostProxy);
  if (target.origin !== selfHostProxy || target.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) throw Error('self-host-dev-proxy-target');
}
const proxy = selfHostProxy ? Object.fromEntries(['/api/auth', '/sync', '/workspaces'].map(path =>
  [path, { target: selfHostProxy, changeOrigin: true }])) : undefined;
export default defineConfig({ worker: pdfWorkerOptions, plugins: [react(), tailwindcss(), {
  name: 'keepany-intake-url',
  configureServer(server) {
    let metadataMiddleware: ReturnType<typeof createUrlMetadataMiddleware> | undefined;
    server.middlewares.use((request, response, next) => {
      const address = server.httpServer?.address();
      if (!address || typeof address === 'string') return next();
      metadataMiddleware ??= createUrlMetadataMiddleware(`http://127.0.0.1:${address.port}`);
      return metadataMiddleware(request, response, next);
    });
  },
}, VitePWA({
  registerType:'autoUpdate', injectRegister:null,
  includeAssets: ['icons/*.png', 'icons/*.svg'],
  manifest: {
    id:'/', name:'KeepAny', short_name:'KeepAny', start_url:'/', scope:'/',
    theme_color:'#fff9ec', background_color:'#fff9ec', display:'standalone',
    icons:[
      {src:'/icons/keepany-192.png',sizes:'192x192',type:'image/png',purpose:'any'},
      {src:'/icons/keepany-512.png',sizes:'512x512',type:'image/png',purpose:'any'},
      {src:'/icons/keepany-maskable-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'},
    ],
  },
  workbox:{maximumFileSizeToCacheInBytes:5000000},
})], build:{outDir:'dist'},server:{fs:{allow:['../..']},proxy} });
