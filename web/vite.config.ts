import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { DEV_WEB_CSP, WEB_CSP } from '../server/src/http/csp.ts';

// El server escucha en PORT (por defecto 3000); la web lo usa a través del proxy /api.
const serverPort = process.env.PORT ?? '3000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Tipos de la API definidos en el server, sin un tercer workspace (plan.md, Structure Decision).
      '@api-types': fileURLToPath(new URL('../server/src/http/types.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // La recarga en caliente necesita un script inline; la web compilada no (research R-16, AC-256).
    headers: { 'Content-Security-Policy': DEV_WEB_CSP },
    proxy: {
      '/api': `http://localhost:${serverPort}`,
    },
  },
  preview: {
    headers: { 'Content-Security-Policy': WEB_CSP },
  },
});
