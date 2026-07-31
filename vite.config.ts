/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
  // `vite preview` reads its own proxy config, not `server.proxy` — without
  // this, `npm run preview` (port 4173, already CORS-allowlisted in
  // backend/app/main.py) would fall through to the SPA's index.html for any
  // /api/* request instead of reaching the backend.
  preview: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
})
