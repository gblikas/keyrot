import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Allow unhandled rejections from async timeout/error tests
    // These are expected when testing queue timeouts and error scenarios
    dangerouslyIgnoreUnhandledErrors: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['app/**/*.ts'],
      exclude: ['app/index.ts'],
    },
  },
});
