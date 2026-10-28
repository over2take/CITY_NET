import { defineConfig } from '@playwright/test';
import os from 'os';
import path from 'path';

// The browser journeys (4l; plan row 4l browser-journey): the real backend and the real frontend,
// driven in one headless browser. Each run starts both on ports of their own (5055, 5174), so a dev
// setup already on 5000 and 5173 is never touched, with a database made fresh for the run in the
// system's temp folder and a GM account that exists only there. Secure Mode is on, as at a real
// table: everyone signs in.
//
// CI runs it on every pull request (.github/workflows/ci.yml), with Playwright's own Chromium. On a
// developer's machine it runs only when asked (cd e2e && npm test), with the Chrome already
// installed there, so nothing large is downloaded.

const BACKEND_PORT = 5055;
const FRONTEND_PORT = 5174;

/** The throwaway GM: this database only. The tests sign in with it. */
export const GM = { username: 'e2e_gm', password: 'e2e-only-password' };

// Named once, by the run itself: the test workers read this file too, and must not make another.
process.env.E2E_DATABASE ||= path.join(os.tmpdir(), `citynet-e2e-${Date.now()}.db`);
const database = process.env.E2E_DATABASE;

export default defineConfig({
  testDir: './tests',
  globalSetup: './cleanup.ts',
  // One browser, one test at a time: the journeys share one database and one game.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  // Two minutes: CI runs about four times slower than a desktop, and tests of 15 s here took past
  // one minute there (builder-dice, the bell, the journey, the clicks sweep; 2026-10-24 to 10-27).
  timeout: 120_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${FRONTEND_PORT}`,
    viewport: { width: 1366, height: 820 },
    // The Chrome installed on a developer's machine; Playwright's own Chromium in CI, or with
    // E2E_CHROMIUM=1 where there is no Chrome (npx playwright install chromium first).
    ...(process.env.CI || process.env.E2E_CHROMIUM ? {} : { channel: 'chrome' }),
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node server.js',
      cwd: path.join(__dirname, '..', 'backend'),
      url: `http://127.0.0.1:${BACKEND_PORT}/api/version`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: String(BACKEND_PORT),
        DB_PATH: database,
        JWT_SECRET: 'e2e-secret-not-for-anything-else',
        ADMIN_USER: GM.username,
        ADMIN_PASS: GM.password,
        SECURE_MODE: 'true',
      },
    },
    {
      command: `npx vite --port ${FRONTEND_PORT} --strictPort --host 127.0.0.1`,
      cwd: path.join(__dirname, '..', 'frontend'),
      url: `http://127.0.0.1:${FRONTEND_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { API_TARGET: `http://127.0.0.1:${BACKEND_PORT}` },
    },
  ],
});
