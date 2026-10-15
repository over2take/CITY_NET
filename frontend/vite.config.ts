import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'))

// Where the dev server sends /api, /uploads and the socket: the backend on 5000, or another for
// the browser tests (e2e/), which run their own beside a dev setup that may already be on 5000.
const api = process.env.API_TARGET || 'http://127.0.0.1:5000'

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    proxy: {
      '/api': api,
      '/uploads': api,
      '/socket.io': {
        target: api,
        ws: true
      }
    }
  }
})