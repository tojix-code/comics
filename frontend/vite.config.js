import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development the Vite dev server proxies /api to the backend
    // (manga-novel-api, default http://localhost:3001), so the frontend
    // never needs to know the backend origin. Set VITE_API_URL to point
    // the built app at a deployed backend instead.
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  preview: { port: 5173 },
  test: {
    environment: 'jsdom',
    globals: false,
    // Unit tests only — the live smoke tests in src/__smoke__ run via
    // `npm run test:e2e` (vitest.e2e.config.js) and are not part of CI.
    include: ['src/lib/**/*.{test,spec}.{js,jsx}', 'src/components/**/*.{test,spec}.{js,jsx}'],
  },
});
