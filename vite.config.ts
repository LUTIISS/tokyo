import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

// BASE_PATH задаёт GitHub Actions (например, /tokyo/). Локально — корень.
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  base,
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
