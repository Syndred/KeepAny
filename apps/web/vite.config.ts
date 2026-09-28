import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({ plugins: [react(), tailwindcss(), VitePWA({ registerType:'prompt', manifest:{name:'KeepAny',short_name:'KeepAny',theme_color:'#fff8e9',background_color:'#fff8e9',display:'standalone',icons:[]},workbox:{maximumFileSizeToCacheInBytes:5000000}})], build:{outDir:'dist'},server:{fs:{allow:['../..']}} });
