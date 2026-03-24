// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import-x';
import unusedImports from 'eslint-plugin-unused-imports';
import checkFile from 'eslint-plugin-check-file';
import pluginN from 'eslint-plugin-n';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import jsdoc from 'eslint-plugin-jsdoc';
import regexpPlugin from "eslint-plugin-regexp"

/**
 * GLOBAL ARCHITECTURAL GUARDRAILS
 * These apply to all source files to ensure a "Zero-Skip" and Security-First environment.
 */
const RESTRICTED_SYNTAX_RULES = [
  // Coverage & lint bypasses are enforced by no-warning-comments rule (line ~175)
  // (AST selectors cannot match comments — they are not AST nodes)

  // Type Bypasses (Non-null assertions)
  {
    selector: 'TSNonNullExpression',
    message: '🚫 TYPE SKIP: Do not use non-null assertions (!). Use optional chaining (?.) or a proper null check.',
  },

  // Return Value Integrity (Blocking null & undefined returns)
  {
    // NOTE: TSMethodDefinition is not a real AST node — this selector only matches
    // TSFunctionType and FunctionDeclaration. Fixing to MethodDefinition requires
    // migrating all void/null returns in class methods first (separate PR).
    selector: ':matches(TSFunctionType, TSMethodDefinition, FunctionDeclaration) TSTypeAnnotation :matches(Identifier[name=\'null\'], Identifier[name=\'undefined\'], TSNullKeyword, TSUndefinedKeyword)',
    message: "🚫 ARCHITECTURE: Functions cannot return 'null' or 'undefined'. Use a Result Pattern (e.g., IScraperResult).",
  },
  {
    selector: ':matches(TSFunctionType, TSMethodDefinition, FunctionDeclaration) TSTypeAnnotation TSVoidKeyword',
    message: "🚫 ARCHITECTURE: 'void' is forbidden. Every function must return a meaningful value or status object.",
  },
  {
    selector: "ReturnStatement[argument.type='Literal'][argument.value=null], ReturnStatement[argument.type='Identifier'][argument.name='undefined']",
    message: '🚫 LOGIC: Forbidden return value. Functions must explicitly return a valid object or primitive.',
  },

  // Nested Logic & Readability
  {
    selector: "CallExpression > .arguments[type='CallExpression']",
    message: '🚫 FORBIDDEN NESTED CALL: Assign the nested function result to a descriptive variable first for better debugging.',
  },
  {
    selector: "CallExpression[callee.property.name='isStuckOnLoginPage']",
    message: "🚫 FORBIDDEN METHOD: Usage of 'isStuckOnLoginPage' is globally banned.",
  },

  // Security & Logging
  {
    selector: "CallExpression[callee.object.name='logger'] Property[key.name=/password|token|secret|auth|creditCard|cvv/i]",
    message: 'SECURITY: Do not log sensitive data keys.',
  },
  {
    selector: "ThrowStatement > NewExpression[callee.name='Error']",
    message: "Do not use 'throw new Error()'. Use a custom Error class (e.g., 'throw new ScraperError()') for PII safety.",
  },

  // 7. Type Integrity (Global — non-Pipeline)
  {
    selector: 'VariableDeclarator > TSTypeAnnotation TSUnknownKeyword',
    message: "🚫 TYPE SKIP: Do not declare variables as 'unknown'. Cast them to a concrete type immediately.",
  },
  // Type Bypasses (as never / as any)
  {
    selector: "TSAsExpression > :matches(TSNeverKeyword, TSAnyKeyword)",
    message: "🚫 TEST INTEGRITY: Do not use 'as never' or 'as any' in mocks. Use 'DeepPartial<T>' or implement the required interface members.",
  },
  // Note: error.message, empty-string, empty-assignment, hardcoded-success,
  // non-null assertion, and unknown param/return rules are in Pipeline section 6 only.

  // Procedure caller: do not discard Procedure results
  {
    selector: "ExpressionStatement > :matches(CallExpression[callee.property.name=/^(record|printSummary|sendSummary|sendError|sendMessage|startImport|cleanOldLogs)$/], AwaitExpression > CallExpression[callee.property.name=/^(record|printSummary|sendSummary|sendError|sendMessage|startImport|cleanOldLogs)$/])",
    message: "🚫 PROCEDURE: Do not discard Procedure result. Check with isSuccess()/isFail() or assign to variable.",
  },
  {
    selector: "MethodDefinition[key.name=/^(writeTo|createNew|deleteFrom)/] ReturnStatement:not([argument])",
    message: "🚫 RESULT PATTERN: Data-writing methods must return Procedure, not void."
  },
  // Block: for-in loops, labeled statements, with statements
  'ForInStatement',
  'LabeledStatement',
  'WithStatement',

  // 8. Anti-Sleep Policy
  {
    selector: "CallExpression[callee.name='sleep']",
    message: "🚫 BRITTLE LOGIC: 'sleep()' is forbidden. Use a proper 'waitFor' mechanism.",
  },
  {
    selector: "CallExpression[callee.name='setTimeout'][arguments.length=2]",
    message: "🚫 BRITTLE LOGIC: Manual 'setTimeout' delays are forbidden.",
  },
  {
    selector: "CallExpression[callee.name='delay']",
    message: "🚫 BRITTLE LOGIC: 'delay()' is forbidden.",
  },

  // 9. Concurrency & Data Integrity Guards
  // GUARD 1: Prevent swallowing aggregate errors
  {
    selector: "CallExpression[callee.object.name='Promise'][callee.property.name='any']",
    message: "🚫 CONCURRENCY: Promise.any() swallows errors. Use Promise.allSettled() to ensure we log WHY every attempt failed.",
  },
  // GUARD 2: Prevent transforming Errors into "Empty Success"
  {
    selector: [
      "IfStatement[test.argument.property.name='isOk'] ReturnStatement > ArrayExpression[elements.length=0]",
      "IfStatement[test.callee.name='isFail'] ReturnStatement > ArrayExpression[elements.length=0]",
      "IfStatement[test.argument.callee.name='isSuccess'] ReturnStatement > ArrayExpression[elements.length=0]",
    ].join(', '),
    message: "🚫 DATA INTEGRITY: Do not return an empty array [] on failure. This triggers false 'Zero Data' states. Propagate the failure Result instead.",
  },

  // 10. Obfuscation & Naming
  {
    selector: "VariableDeclarator > ObjectPattern > Property[kind='init'][value.name.length<3], ArrowFunctionExpression > ObjectPattern > Property[kind='init'][value.name.length<3]",
    message: '🚫 OBFUSCATION: Do not use short aliases. Use descriptive names.',
  },
  {
    selector: "CallExpression[callee.name='describe'] > Literal[value=/^(test|run|batch|suite)/i]",
    message: '🚫 GENERIC DESCRIPTION: Use the Feature Name in the describe block.',
  },
  {
    selector: "CatchClause BinaryExpression[left.property.name='message']",
    message: "🚫 Use errorMessage() utility instead of manual error.message access in catch blocks.",
  },


];

export default tseslint.config(
  // 1. GLOBAL IGNORES
  {
    ignores: ['.github/**', 'lib/**', 'node_modules/**', 'coverage/**', 'src/coverage/**', 'tsup.config.ts', '**/*.js', '**/*.mjs', '**/*.cjs'],
  },

  // 2. BASE CONFIGS
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  prettier,
  regexpPlugin.configs['flat/recommended'],

  // 3. MAIN SOURCE FILES (STRICT)
  {
    files: ['src/**/*.ts'],
    plugins: {
      'import-x': importPlugin,
      'unused-imports': unusedImports,
      'check-file': checkFile,
      'n': pluginN,
      'simple-import-sort': simpleImportSort,
      regexp: regexpPlugin,
      jsdoc,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.es2021, document: 'readonly', window: 'readonly', fetch: 'readonly', Headers: 'readonly' },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
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
            'eslint-disable',
          ],
          location: 'anywhere',
        },
      ],
      'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX_RULES],
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true, 'ts-nocheck': true, 'ts-check': true, minimumDescriptionLength: 10 }],
      '@typescript-eslint/no-non-null-assertion': 'error',

      // === IMPORTS ===
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/max-dependencies': ['error', { max: 15, ignoreTypeImports: true }],
      'import-x/prefer-default-export': 'error',

      // === REGEX BEST PRACTICES ===
      "regexp/no-super-linear-backtracking": "error", // Critical for ReDoS prevention
      "regexp/no-useless-escape": "error", // Prevents unnecessary escaping that can obfuscate regexes
      "regexp/prefer-character-class": "warn", // Encourages character classes for better readability and performance
      "regexp/optimal-quantifier-concatenation": "warn", // Suggests optimal quantifier patterns


      // === STYLE & RETURN TYPES ===
      'quotes': ['error', 'single', { avoidEscape: true }],
      '@typescript-eslint/explicit-member-accessibility': ['error', { accessibility: 'explicit', overrides: { constructors: 'no-public' } }],
      '@typescript-eslint/explicit-function-return-type': ['error', {
        allowExpressions: true,
        allowTypedFunctionExpressions: true,
        allowHigherOrderFunctions: true,
      }],
      'no-nested-ternary': 'error',
      'class-methods-use-this': 'error',
      'arrow-body-style': 'off',
      'no-shadow': 'off',
      'no-await-in-loop': 'error',

      // === THE "ONE PER FILE" & PASCAL_CASE NAMING ===
      'max-classes-per-file': ['error', 1],
      'check-file/filename-naming-convention': [
        'error',
        { 'src/**/*.{ts,tsx}': 'PASCAL_CASE' },
        { ignoreMiddleExtensions: true },
      ],
      'check-file/folder-naming-convention': [
        'error',
        { 'src/**/': 'PASCAL_CASE' },
      ],

      // === NAMING CONVENTIONS ===
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'interface', format: ['PascalCase'], custom: { regex: '^I[A-Z]', match: true } },
        { selector: ['variable', 'function', 'method'], format: ['camelCase'] },
        { selector: 'variable', types: ['boolean'], format: ['PascalCase'], prefix: ['is', 'has', 'should', 'can', 'did', 'will', 'was'] },
        { selector: 'variable', modifiers: ['const', 'global'], format: ['UPPER_CASE'], leadingUnderscore: 'allow' },
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        { selector: 'classProperty', modifiers: ['private'], format: ['camelCase'], leadingUnderscore: 'require' },
        { selector: 'typeParameter', format: ['PascalCase'], prefix: ['T'] },
        { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
      ],

      // === CLEAN CODE LIMITS ===
      'max-lines-per-function': ['error', { max: 20, skipBlankLines: true, skipComments: true }],
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      '@typescript-eslint/max-params': ['error', { max: 3 }],
      'complexity': ['error', { max: 10 }],

      // === JSDOC DOCUMENTATION ===
      'jsdoc/require-jsdoc': ['error', {
        publicOnly: false,
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
      'jsdoc/require-param-type': 'off',
      'jsdoc/require-returns': 'error',
      'jsdoc/require-returns-description': 'error',
      'jsdoc/require-returns-type': 'off',
      'jsdoc/check-param-names': 'error',
      'jsdoc/check-tag-names': 'error',

      // === STRICT TYPE SAFETY (NO ANY) ===
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',

      // === DEAD CODE & UNUSED ===
      'no-unused-vars': ['error', { args: 'none' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': ['error', { vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' }],
      'no-unreachable': 'error',
      'no-unused-expressions': 'error',
      '@typescript-eslint/no-unused-private-class-members': 'error',
      '@typescript-eslint/member-ordering': ['error', {
        default: [
          'public-static-field', 'protected-static-field', 'private-static-field',
          'public-instance-field', 'protected-instance-field', 'private-instance-field',
          'constructor',
          'public-instance-method', 'protected-instance-method', 'private-instance-method',
        ],
      }],

      // === FORMATTING ===
      'max-len': ['error', { code: 100, ignoreUrls: true, ignoreStrings: true, ignoreComments: true }],

      // === NODE.JS CONVENTIONS ===
      'n/prefer-node-protocol': 'error',

      // === TYPE IMPORTS ===
      '@typescript-eslint/consistent-type-imports': ['error', {
        prefer: 'type-imports',
        fixStyle: 'separate-type-imports',
      }],

      // === NULL SAFETY ===
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
        ...RESTRICTED_SYNTAX_RULES,
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

  // 4. TEST / MOCK (RELAXED)
  {
    files: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'src/Tests/**/*.ts', '**/mocks/**/*.ts'],
    rules: {
      'no-console': 'off',
      'max-lines-per-function': 'off',
      'max-len': 'off',
      'check-file/filename-naming-convention': 'off',
      'check-file/folder-naming-convention': ['error', { 'src/**/': 'PASCAL_CASE' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/member-ordering': 'error',
      'jsdoc/require-jsdoc': 'error',
      'jsdoc/require-description': 'error',
      'no-restricted-syntax': [
        'error',
        ...RESTRICTED_SYNTAX_RULES,
        {
          selector: "CallExpression[callee.object.name='vi'][callee.property.name='spyOn'] Literal[value='getLogger']",
          message: "🚫 TEST: Do not use vi.spyOn for logger. Use vi.mock with hoisted pattern instead.",
        },
      ],

    },

  },

  // 5. PIPELINE TESTS: inherit section 4 test rules (no special exemptions)

  // 6. PIPELINE LOGIC (DI, MEDIATOR, HANDLERS & RESULT PATTERN)
  {
    files: ['src/Scrapers/Pipeline/**/*.ts'],
    rules: {
      // === DEPENDENCY INJECTION & MEDIATOR BOUNDARY ===
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['**/Registry/Config/**'],
            message: '🚫 DI: Use ctx.config — do not import ScraperConfig directly.',
          },
          {
            group: ['**/Constants/**', '**/env'],
            message: '🚫 DI: Use ctx.config instead of direct imports.',
          },
          {
            group: ['**/Mediator/Internals/**'],
            message: '🚫 MEDIATOR: Access HTML resolution only via ctx.mediator.',
          },
          // GAP FIX #3 — Block deep relative imports (mediator bypass)
          {
            group: ['../../../*'],
            message: '🚫 MEDIATOR: Deep relative imports bypass the mediator. Use ctx.mediator or ctx.services.',
          },
        ],
      }],

      // === IMMUTABLE CONTEXT (Middleware Pipeline pattern) ===
      // GAP FIX #1 — Prevents ctx.foo = bar mutations
      'no-param-reassign': ['error', { props: true }],

      // === RESTRICTED SYNTAX (global + pipeline-specific) ===
      'no-restricted-syntax': [
        'error',
        ...RESTRICTED_SYNTAX_RULES,

        // Type Integrity (Pipeline-only — stricter than global)
        {
          // Matches: function(x: unknown) or (x: unknown) => ...
          selector: ':matches(FunctionDeclaration, ArrowFunctionExpression, TSMethodDefinition) Identifier > TSTypeAnnotation > TSUnknownKeyword',
          message: "🚫 ARCHITECTURE: Function parameters cannot be 'unknown'. Define a specific Interface (e.g., IBankData).",
        },
        {
          // Matches: function(): unknown { ... }
          selector: ':matches(FunctionDeclaration, ArrowFunctionExpression, TSMethodDefinition) > TSTypeAnnotation TSUnknownKeyword',
          message: "🚫 ARCHITECTURE: Functions cannot return 'unknown'. Define a concrete return Type.",
        },

        // DI: No hardcoded Config keys in Objects
        {
          selector: 'Property[key.name=/viewport|width|height|timeout|delay|retries/i] > Literal',
          message: "🚫 DI: Config values (timeouts/dimensions) must be injected via 'ctx.config'.",
        },

        // DI: No hardcoded Browser/Framework API Arguments
        {
          selector: "CallExpression[callee.property.name=/goto|waitForTimeout|setViewport|setTimeout|waitForSelector|click|type/] > Literal",
          message: "🚫 DI: Browser interactions must use selectors/URLs from 'ctx.constants' or 'ctx.config'.",
        },

        // DI: No manual instantiation of Service/Logic classes
        {
          selector: "NewExpression[callee.name=/^(?!Error|Map|Set|Date|RegExp|URL|Headers|Promise|ScraperError|PipelineBuilder)[A-Z]/]",
          message: "🚫 DI: Do not 'new' up handlers or services. Inject via PipelineContext.",
        },

        // ARCHITECTURE: No hardcoded Status Strings
        {
          selector: "BinaryExpression[operator='==='] > Literal[value=/^(success|failure|pending|error|done)$/i]",
          message: '🚫 ARCHITECTURE: Use Enums or Constants for type discriminators/status checks.',
        },

        // Error Handling: No manual error.message access
        {
          selector: "CatchClause MemberExpression[property.name='message']",
          message: '🚫 Use errorMessage(error) utility instead of manual error.message access.',
        },
        // Non-null assertion guard
        {
          selector: 'TSNonNullExpression',
          message: '🚫 TYPE SKIP: Do not use (!). Use optional chaining (?.) or a proper null check.',
        },
        // Empty string fallback guard
        {
          selector: "LogicalExpression[right.type='Literal'][right.value='']",
          message: "🚫 DATA INTEGRITY: Do not fallback to an empty string (''). Return a Failure Result or throw a ScraperError.",
        },
        // Empty assignment guard
        {
          selector: "AssignmentExpression[right.type='Literal'][right.value='']",
          message: "🚫 ARCHITECTURE: Do not assign empty strings. Use a concrete value or handle the 'Missing' state explicitly.",
        },
        // Result Pattern: force succeed()/fail() factories
        {
          selector: "ReturnStatement > ObjectExpression > Property[key.name='success']",
          message: "🚫 RESULT PATTERN: Do not hardcode the success boolean. Use the 'succeed()' or 'fail()' factory functions.",
        },

        // Handler Delegation: Phases must call handlers
        {
          selector: "ClassDeclaration[id.name=/Phase$/] MethodDefinition[key.name='execute'] BlockStatement > :not(ExpressionStatement[expression.callee.property.name=/handle|executeHandler/]):not(ReturnStatement)",
          message: '🚫 ARCHITECTURE: Phase logic must be delegated to a Handler. Use ctx.handlers.execute().',
        },

        // No else blocks — guard clauses only
        {
          selector: 'IfStatement[alternate]',
          message: "🚫 'else' blocks are disallowed. Use early returns (Guard Clauses).",
        },

        // No ternary — use logical lookups
        {
          selector: 'ConditionalExpression',
          message: '🚫 Ternary operators are disallowed. Use logical lookups.',
        },

        // Result Pattern: No primitive returns
        {
          selector: "TSMethodDefinition[key.name!=/^(constructor|setup|init)$/] > TSTypeAnnotation > :matches(TSStringKeyword, TSNumberKeyword, TSBooleanKeyword)",
          message: '🚫 RESULT PATTERN: Do not return primitives directly. Return an IScraperResult.',
        },

        // Result Pattern: No inline object returns — use succeed()/fail()
        {
          selector: 'ReturnStatement > ObjectExpression',
          message: '🚫 RESULT PATTERN: Do not return inline objects. Use succeed(value) or fail(type, msg).',
        },

        // Result Pattern: No throw
        {
          selector: 'ThrowStatement',
          message: '🚫 RESULT PATTERN: Do not throw. Return a failure Result object instead.',
        },

        // Pagination: No manual while loops — use Pagination strategy
        // GAP FIX #4 — Forces pagination abstraction
        {
          selector: 'WhileStatement',
          message: '🚫 PAGINATION: Do not use manual while loops. Use the Pagination strategy abstraction.',
        },
        {
          selector: 'DoWhileStatement',
          message: '🚫 PAGINATION: Do not use manual do-while loops. Use the Pagination strategy abstraction.',
        },
      ],

      'no-else-return': ['error', { allowElseIf: false }],
      'max-depth': ['error', 1],
      '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: false, allowTypedFunctionExpressions: false }],
    },
  },

  // 6b. PIPELINE INFRASTRUCTURE EXEMPTIONS (Types, Builder, Runner define contracts — need deep imports)
  {
    files: ['src/Scrapers/Pipeline/Types/**/*.ts', 'src/Scrapers/Pipeline/Builder/**/*.ts', 'src/Scrapers/Pipeline/Runner/**/*.ts', 'src/Scrapers/Pipeline/Index.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },

  // 7. CANARY TEST FILES (applies guardrail rules so canary checks work)
  {
    files: ['tests/eslint-canaries/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        project: './tsconfig.test.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-restricted-syntax': ['error', ...RESTRICTED_SYNTAX_RULES],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'error',
    },
  },

  // 8. ENTRY POINT EXEMPTIONS
  {
    files: ['src/index.ts', 'src/Index.ts', 'src/scheduler.ts', 'src/Scheduler.ts', 'src/**/index.ts', 'src/**/Index.ts'],
    rules: {
      'check-file/filename-naming-convention': 'off',
      'import-x/max-dependencies': 'off',
      'no-await-in-loop': 'off',
    },
  },

  // 9. SEQUENTIAL PROCESSING EXEMPTIONS (iterative await-in-loop is intentional)
  {
    files: [
      'src/Services/TelegramPoller.ts',
      'src/Services/Notifications/TelegramNotifier.ts',
      'src/Resilience/GracefulShutdown.ts',
      'src/Resilience/RetryStrategy.ts',
      'src/Services/AccountImporter.ts',
      'src/Services/ImportQueue.ts',
      'src/Services/TransactionService.ts',
    ],
    rules: {
      'no-await-in-loop': 'off',
    },
  },

  // 10. PRE-EXISTING REGEX PATTERNS (warn until refactored)
  {
    files: [
      'src/Config/ConfigLoaderValidator.ts',
      'src/Services/Notifications/TelegramNotifier.ts',
    ],
    rules: {
      'regexp/no-super-linear-backtracking': 'warn',
    },
  },
);
