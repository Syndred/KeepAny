import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
const selfHostProxy = process.env.KEEPANY_SELFHOST_DEV_PROXY_TARGET;
if (selfHostProxy) {
  const target = new URL(selfHostProxy);
  if (target.origin !== selfHostProxy || target.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) throw Error('self-host-dev-proxy-target');
}
const proxy = selfHostProxy ? Object.fromEntries(['/api/auth', '/sync', '/workspaces'].map(path =>
  [path, { target: selfHostProxy, changeOrigin: true }])) : undefined;
export default defineConfig({ plugins: [react(), tailwindcss(), VitePWA({ registerType:'prompt', manifest:{name:'KeepAny',short_name:'KeepAny',theme_color:'#fff8e9',background_color:'#fff8e9',display:'standalone',icons:[]},workbox:{maximumFileSizeToCacheInBytes:5000000}})], build:{outDir:'dist'},server:{fs:{allow:['../..']},proxy} });
