// @ts-check
/**
 * Dedicated ESLint flat config for the portal's browser SPA
 * (`src/Portal/Public/**\/*.js`).
 *
 * The main `eslint.config.mjs` globally ignores `**\/*.js` and layers
 * type-checked TypeScript presets that do not fit a no-build, vanilla-JS,
 * browser ES module. This isolated config lints ONLY the served `.js` so the
 * pre-commit ESLint gate can enforce one guardrail there: a top-level call to a
 * local function must be awaited (or assigned), never left floating. That keeps
 * the SPA boot entry point as `await init()` (top-level await, valid because
 * `index.html` loads it via <script type="module">) and prevents a regression
 * back to a fire-and-forget `init()` — SonarCloud rule S7785.
 *
 * The canary directory is included so `config/check-eslint-canaries.mjs` can
 * assert the rule is alive against a deliberately-floating fixture.
 */
import globals from 'globals';

export default [
  {
    files: ['src/Portal/Public/**/*.js', 'tests/eslint-canaries/portal/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
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
