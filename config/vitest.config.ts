import babel from 'vite-plugin-babel';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    babel({
      // vite-plugin-babel 2.x uses Vite-convention `include`/`exclude` for
      // file selection (the legacy 1.6.x `filter` is gone). `include`
      // defaults to /\.jsx?$/ which would silently skip .ts files; setting
      // it explicitly keeps .ts routed through babel so Stage 3 decorators
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
