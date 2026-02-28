// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import unusedImports from 'eslint-plugin-unused-imports';
import filenames from 'eslint-plugin-filenames';

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
    // 2. Added filenames to the plugins object
    plugins: { 
      'unused-imports': unusedImports,
      'filenames': filenames 
    },
    rules: {
      // === THE "ONE PER FILE" RULE ===
      "max-classes-per-file": ["error", 1],
      
      // Forces file name to match the exported class/interface (e.g., UserService.ts)
      // This effectively prevents hiding multiple major entities in one file.
      "filenames/match-exported": ["error", "kebab"], 

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
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'unused-imports/no-unused-imports': 'error',
      'no-unreachable': 'error',
      'no-unused-expressions': 'error',
      '@typescript-eslint/no-unused-private-class-members': 'error',

      // === FORMATTING ===
      'max-len': ['error', { code: 100, ignoreUrls: true }],
    },
  },
  // === EXEMPTIONS: tests/configs ===
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/mocks/**', 'eslint.config.mjs'],
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      'max-len': 'off',
      'filenames/match-exported': 'off', // Tests often don't match export names
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  }
);
