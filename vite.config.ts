import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  css: { postcss: { plugins: [tailwindcss()] } },
  server: { host: '0.0.0.0' },
  build: {
    rolldownOptions: {
      output: {
        manualChunks: (id: string) =>
          id.includes('/three/') ? 'three' : undefined,
      },
    },
  },
});
