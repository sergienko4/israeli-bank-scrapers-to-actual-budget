// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import unusedImports from 'eslint-plugin-unused-imports';
import checkFile from 'eslint-plugin-check-file';
import pluginN from 'eslint-plugin-n';
import jsdoc from 'eslint-plugin-jsdoc';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'unused-imports': unusedImports,
      'check-file': checkFile,
      'n': pluginN,
      'jsdoc': jsdoc,
    },
    rules: {
      // ── Logging & Security ───────────────────────────────────────────────
      'no-console': 'error',
      'no-warning-comments': [
        'error',
        {
          terms: [
            'todo',
            'fixme',
            'istanbul ignore',
            'c8 ignore',
            'v8 ignore',
            '@ts-ignore',
            '@ts-nocheck',
            '@ts-expect-error',
            'eslint-disable'
          ],
          location: 'anywhere'
        }
      ],
      // === THE "ONE PER FILE" & PASCAL_CASE NAMING ===
      "max-classes-per-file": ["error", 1],
      'check-file/filename-naming-convention': [
        'error',
        { 'src/**/*.{ts,tsx}': 'PASCAL_CASE' },
        { ignoreMiddleExtensions: true },
      ],
      'check-file/folder-naming-convention': [
        'error',
        { 'src/**/': 'PASCAL_CASE' },
      ],

      // === CLEAN CODE LIMITS ===
      'max-lines-per-function': ['error', { max: 20, skipBlankLines: true, skipComments: true }],
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      '@typescript-eslint/max-params': ['error', { max: 3 }],
      'complexity': ['error', 10],

      // === JSDOC DOCUMENTATION ===
      'jsdoc/require-jsdoc': ['error', {
        publicOnly: false, // Ensures ALL functions (even private) have comments
        require: {
          FunctionDeclaration: true,
          MethodDefinition: true,
          ClassDeclaration: true,
          ArrowFunctionExpression: true,
          FunctionExpression: true,
        },
      }],
      'jsdoc/require-description': ['error', { contexts: ['any'] }],
      'jsdoc/require-param': 'error',
      'jsdoc/require-param-description': 'error',
      'jsdoc/require-param-type': 'off', // TS handles types
      'jsdoc/require-returns': 'error',
      'jsdoc/require-returns-description': 'error',
      'jsdoc/require-returns-type': 'off', // TS handles types
      'jsdoc/check-param-names': 'error',
      'jsdoc/check-tag-names': 'error',


      // === STRICT TYPE SAFETY (NO ANY) ===
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/explicit-function-return-type': ['error', {
        allowExpressions: true,
        allowTypedFunctionExpressions: true,
        allowHigherOrderFunctions: true,
      }],

      // === DEAD CODE & UNUSED ===
      'no-unused-vars': ['error', { args: 'none' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'unused-imports/no-unused-imports': 'error',
      'no-unreachable': 'error',
      'no-unused-expressions': 'error',
      '@typescript-eslint/no-unused-private-class-members': 'error',
      '@typescript-eslint/member-ordering': ['error', {
        default: ['public-method', 'protected-method', 'private-method'],
      }],

      // === FORMATTING ===
      'max-len': ['error', { code: 100, ignoreUrls: true }],

      // === NODE.JS CONVENTIONS ===
      'n/prefer-node-protocol': 'error',

      // === TYPE IMPORTS ===
      '@typescript-eslint/consistent-type-imports': ['error', {
        prefer: 'type-imports',
        fixStyle: 'separate-type-imports',
      }],

      // === NULL SAFETY ===
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': ['error', {
        ignorePrimitives: { string: true },
        ignoreMixedLogicalExpressions: true,
      }],

      // === PREFER MODERN APIS ===
      '@typescript-eslint/prefer-string-starts-ends-with': 'error',
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'error',
      '@typescript-eslint/prefer-includes': 'error',
      '@typescript-eslint/explicit-module-boundary-types': ['error', {
        allowTypedFunctionExpressions: true,
        allowHigherOrderFunctions: true,
      }],

      // === LOGGING & SECURITY ===
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='logger'] " +
            "Property[key.name=/^(password|token|secret|auth|creditCard|cvv)$/i]",
          message: 'SECURITY: Do not log sensitive data. Add to pino redact paths instead.',
        },
      ],
    },

  },
  // === EXEMPTION: Logger implementations may call console (they ARE the logging layer) ===
  {
    files: ['src/Logger/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  // === UTILS: mandatory logger call + security (overrides base no-restricted-syntax) ===
  {
    files: ['src/Utils/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='logger'] " +
            "Property[key.name=/^(password|token|secret|auth|creditCard|cvv)$/i]",
          message: 'SECURITY: Do not log sensitive data.',
        },
        {
          selector: [
            "FunctionDeclaration:not(:has(CallExpression[callee.object.name='logger']))",
            "VariableDeclarator > ArrowFunctionExpression" +
            ":not(:has(CallExpression[callee.object.name='logger']))",
          ].join(', '),
          message: "Utility functions must include a 'logger' call for traceability.",
        },
        // Block: /* istanbul ignore next */
        {
          selector: "Program > Block:matches([value*='istanbul ignore'], [value*='c8 ignore'])",
          message: "🚫 COVERAGE SKIP: Write a test instead of ignoring coverage.",
        },
        // Block: // eslint-disable-next-line
        {
          selector: "Line:matches([value*='eslint-disable'])",
          message: "🚫 LINT SKIP: Do not disable ESLint rules. Fix the underlying issue.",
        },
        // Block: ! (Non-null assertion) - The "Code Skip"
        {
          selector: "TSNonNullExpression",
          message: "🚫 TYPE SKIP: Do not use non-null assertions (!). Use optional chaining (?.) or a proper null check.",
        },
        // ── Your existing security selectors ────────────────────────────────
        {
          selector: "CallExpression[callee.object.name='logger'] Property[key.name=/password|token|secret|auth|creditCard/i]",
          message: 'SECURITY: Do not log sensitive data keys.',
        },
        {
          selector: "ThrowStatement > NewExpression[callee.name='Error']",
          message: "Do not use 'throw new Error()'. Use a custom Error class.",
        },
        {
          selector: "CallExpression[callee.property.name='isStuckOnLoginPage']",
          message: "🚫 FORBIDDEN METHOD: Usage of 'isStuckOnLoginPage' is globally banned.",
        },
        {
          // Targets: any function call that has another function call as an argument
          selector: "CallExpression > .arguments[type='CallExpression']",
          message: "🚫 FORBIDDEN NESTED CALL: Do not pass a function call as an argument. Assign the result to a descriptive variable first for better readability and debugging.",
        },
        'ForInStatement',
        'LabeledStatement',
        'WithStatement',
      ],
    }
  },

  // === EXEMPTIONS: tests/configs ===
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/mocks/**', 'eslint.config.mjs'],
    rules: {
      'max-lines': 'error',
      'max-lines-per-function': 'error',
      'max-len': 'error',
      'check-file/filename-naming-convention': 'error',
      'check-file/folder-naming-convention': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/member-ordering': 'error',
      'no-restricted-syntax': 'error',
      'no-console': 'off',
      'jsdoc/require-jsdoc': 'error',
      'jsdoc/require-description': 'error',
    },
  },

);
