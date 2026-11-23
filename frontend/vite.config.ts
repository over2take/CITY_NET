import { defineConfig } from 'vitest/config'
import { createLogger } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'))

// Where the dev server sends /api, /uploads and the socket: the backend on 5000, or another for
// the browser tests (e2e/), which run their own beside a dev setup that may already be on 5000.
const api = process.env.API_TARGET || 'http://127.0.0.1:5000'

// The socket's proxy reports a browser that closed mid-message (EPIPE, ECONNRESET) as an error with a stack, every time a
// tab or a browser journey's window closes: harmless, and it buried the real errors in a failed CI log (8n4). Only those
// two are dropped; every other proxy error, and everything else, is still said.
const logger = createLogger()
const sayError = logger.error
logger.error = (msg, options) => {
  if (/ws proxy (socket )?error/.test(msg) && /\b(EPIPE|ECONNRESET)\b/.test(msg)) return
  sayError(msg, options)
}

export default defineConfig({
  customLogger: logger,
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