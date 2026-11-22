import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'node:fs';

// Serve the production build locally with the same security headers Vercel will send,
// so `npm run build && npm run preview` shows any CSP breakage before deploying.
const rules = JSON.parse(fs.readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')).headers;
const headers = Object.fromEntries(rules.find((r) => r.source === '/(.*)').headers.map((h) => [h.key, h.value]));

export default defineConfig({
  build: { chunkSizeWarningLimit: 1000 },
  preview: { headers },
  plugins: [
    VitePWA({
      // 'prompt': a new version waits until the user taps "Reload" (never swaps code mid-edit)
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'PDF Editor',
        short_name: 'PDF Editor',
        description: 'Edit, sign and fill PDFs privately. Everything runs on your device.',
        theme_color: '#2563eb',
        background_color: '#e9ebef',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        categories: ['productivity', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Lets Chrome/Edge on desktop offer the app under "Open with" for .pdf files
        file_handlers: [{ action: '/', accept: { 'application/pdf': ['.pdf'] } }],
      },
      workbox: {
        // Everything the editor needs, including the pdf.js worker and the Unicode / signature fonts
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2}', 'assets/noto-sans-*.woff'],
        // Skip scripts the app never uses (signature fonts: Latin only is enough)
        globIgnores: ['**/*cyrillic*', '**/*greek*', '**/sample.pdf'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
      },
    }),
  ],
});
