import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Live end-to-end smoke config: real network, real MangaDex API.
// Run with: npm run test:e2e   (NOT part of `npm test` / CI)
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/__smoke__/**/*.test.jsx'],
    testTimeout: 300000,
  },
});
