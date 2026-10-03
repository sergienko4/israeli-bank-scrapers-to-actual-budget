// @ts-check
/**
 * Dedicated ESLint flat config for the portal's browser SPA
 * (`src/Portal/Public/**\/*.js`).
 *
 * The main `eslint.config.mjs` globally ignores `**\/*.js` and layers
 * type-checked TypeScript presets that do not fit a no-build, vanilla-JS,
 * browser ES module. This isolated config lints ONLY the served `.js` so the
 * pre-commit ESLint gate can enforce two guardrails there:
 *
 * 1. A top-level call to a local function must be awaited (or assigned), never
 *    left floating. That keeps the SPA boot entry point as `await init()`
 *    (top-level await, valid because `index.html` loads it via
 *    <script type="module">) and prevents a regression back to a
 *    fire-and-forget `init()` — SonarCloud rule S7785.
 * 2. No promise may be left floating anywhere (e.g. an async `login()` called
 *    from a keydown handler) — SonarCloud rule S9383, which wraps
 *    typescript-eslint's `no-floating-promises`. That rule needs type
 *    information, so the files are parsed against `config/tsconfig.portal.json`
 *    (allowJs, DOM lib, never type-checked or emitted). An intentional
 *    fire-and-forget is written `void fn()`.
 *
 * The canary directory is included so `config/check-eslint-canaries.mjs` can
 * assert both rules are alive against deliberately-floating fixtures.
 */
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  {
    files: ['src/Portal/Public/**/*.js', 'tests/eslint-canaries/portal/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.portal.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "Program > ExpressionStatement > CallExpression[callee.type='Identifier']",
          message:
            '🚫 TOP-LEVEL AWAIT: A top-level call to a local function must be awaited (e.g. await init()) or assigned, never left floating — SonarCloud S7785. This file is an ES module loaded via <script type="module">.',
        },
      ],
    },
  },
];
