import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  // vendored cafesim simulator core (src/vendor/cafesim, see README there)
  resolve: { alias: { '@cafesim/core': fileURLToPath(new URL('./src/vendor/cafesim/core/index.js', import.meta.url)) } },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  server: { port: 5173 },
});
