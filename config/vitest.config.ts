import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: process.cwd(),
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    hookTimeout: 30_000,
    // Every portal suite boots Fastify in a hook, so the 30s above covers it.
    // PortalBootWarnings cannot: each case sets PORTAL_TRUST_PROXY *before* the
    // boot, so the boot is inherently per-test and is billed against
    // testTimeout instead. That left it alone on vitest's implicit 5s default,
    // where a loaded run measured 4128ms - a 1.21x margin - while sibling
    // suites peaked at 15289ms under the same conditions and stayed safe.
    testTimeout: 15_000,
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
