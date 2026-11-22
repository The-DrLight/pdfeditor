import { defineConfig } from 'vite';
import fs from 'node:fs';

// Serve the production build locally with the same security headers Vercel will send,
// so `npm run build && npm run preview` shows any CSP breakage before deploying.
const rules = JSON.parse(fs.readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')).headers;
const headers = Object.fromEntries(rules.find((r) => r.source === '/(.*)').headers.map((h) => [h.key, h.value]));

export default defineConfig({
  build: { chunkSizeWarningLimit: 1000 },
  preview: { headers },
});
