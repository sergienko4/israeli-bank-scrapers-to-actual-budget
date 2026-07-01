import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: process.cwd(),
    globals: true,
    environment: 'node',
    // Setup hooks (e.g. seedConfigDir) do real filesystem I/O; allow 30s so
    // they do not time out under the loaded pre-commit hook / CI runners.
    hookTimeout: 30000,
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts', 'src/Portal/Public/app.js'],
      exclude: [
        'src/Index.ts',
      ],
      thresholds: {
        lines: 90,
        functions: 95,
        branches: 90,
        statements: 90
      }
    }
  }
});
