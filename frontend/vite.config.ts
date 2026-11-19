import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Entwicklung: /api (inkl. WebSocket) geht an das lokale Backend (uvicorn auf Port 8000).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8000', ws: true },
    },
  },
  build: { sourcemap: false, chunkSizeWarningLimit: 700 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
