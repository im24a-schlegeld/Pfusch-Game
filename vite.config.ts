import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { offlineAssetsPlugin } from './scripts/offline-assets.mjs';
import { loadingArtworkPlugin } from './scripts/loading-art-assets.mjs';
export default defineConfig({
  plugins: [react(), loadingArtworkPlugin(), offlineAssetsPlugin()],
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  css: { postcss: { plugins: [tailwindcss()] } },
  server: {
    host: '0.0.0.0',
    hmr: false,
    // OneDrive can lock PNGs while syncing. Native fs.watch then throws EBUSY
    // and kills Vite. Polling preserves HMR without holding native file watches.
    watch: process.platform === 'win32' ? { usePolling: true, interval: 300 } : undefined,
  },
  build: {
    rolldownOptions: {
      output: {
        manualChunks: (id: string) =>
          id.includes('/three/') ? 'three' : undefined,
      },
    },
  },
});
