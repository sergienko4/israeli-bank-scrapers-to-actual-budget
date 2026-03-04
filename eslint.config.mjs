// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import unusedImports from 'eslint-plugin-unused-imports';
import checkFile from 'eslint-plugin-check-file';

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
    },
    rules: {
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

      // === LOGGING & SECURITY ===
      'no-console': 'error',
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
      ],
    },
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
    },
  },
  // === EXEMPTIONS: lowercase entry-point & utility filenames ===
  {
    files: [
      'src/index.ts',
      'src/scheduler.ts',
      'src/**/index.ts',
      'src/Utils/currency.ts',
      'src/Utils/date.ts',
    ],
    rules: { 'check-file/filename-naming-convention': 'error' },
  },
);
