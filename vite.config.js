import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    // Sin sourcemaps en producción: no publicar el código fuente legible.
    sourcemap: false,
  },
  server: {
    port: 5173,
  },
});
