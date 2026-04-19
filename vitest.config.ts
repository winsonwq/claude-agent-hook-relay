import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Timeout for each test
    testTimeout: 60000,
    // Reporter
    reporter: 'verbose',
  },
});
