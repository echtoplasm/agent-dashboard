/**
 * Vite configuration for the web app.
 *
 * In development, `/api` requests are proxied to the API so the browser sees
 * a single origin and session cookies work without CORS.
 */
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

const DEFAULT_API_PROXY_TARGET = 'http://127.0.0.1:3000';
const DEV_SERVER_PORT = 5173;

export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ['source', ...defaultClientConditions] },
  ssr: { resolve: { conditions: ['source', ...defaultServerConditions] } },
  server: {
    host: '127.0.0.1',
    port: DEV_SERVER_PORT,
    strictPort: true,
    proxy: {
      '/api': process.env.API_PROXY_TARGET ?? DEFAULT_API_PROXY_TARGET,
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
