import babel from 'vite-plugin-babel';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // vite-plugin-babel 1.7.0's babel-options cache is not isolated per
  // vitest worker; concurrent workers intermittently see a partial
  // babel config (without the TS transform plugin), producing random
  // `Unexpected token` parse errors on .ts files. singleFork forces
  // one worker so the cache stays consistent. Drop this once
  // vite-plugin-babel ships an upstream fix. Top-level placement per
  // vitest 4's pool-options rework.
  pool: 'forks',
  poolOptions: {
    forks: { singleFork: true },
  },
  plugins: [
    babel({
      // vite-plugin-babel 1.7.0 renamed `filter` to `include` (Vite-convention
      // include/exclude with optional post-filter). The new default `include`
      // is /\.jsx?$/, which silently excludes .ts files. Setting `include`
      // explicitly keeps .ts routed through babel so Stage 3 decorators
      // (src/Utils/Loggable.ts) parse correctly.
      include: /\.[jt]s$/,
      babelConfig: {
        plugins: [
          ['@babel/plugin-proposal-decorators', { version: '2023-11' }],
          ['@babel/plugin-transform-typescript', { isTSX: false }],
        ],
      },
    }),
  ],
  test: {
    root: process.cwd(),
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
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
