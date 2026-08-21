import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 10000,
    // Makes an unstubbed outbound call fail the test that made it, rather than quietly
    // succeeding against the real service. See the file for why this exists.
    setupFiles: ['./__tests__/setup/noNetwork.js'],
    env: {
      JWT_SECRET: 'test-secret',
    },
  },
});
