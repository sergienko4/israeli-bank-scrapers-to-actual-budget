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
import regexpPlugin from 'eslint-plugin-regexp';

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
      '@typescript-eslint/return-await': ['error', 'always'],
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

  // 6c. SCRAPER LAYER — ban `new <IntegrationService>` (PR 1: ITwoFactorPrompter seam)
  // The Scraper (BP) layer must inject Integration Services via interfaces.
  // Only the composition root (src/Index.ts) is allowed to instantiate them.
  // Pipeline already enforces this via section 6's broader PascalCase-new ban.
  {
    files: [
      'src/Scraper/**/*.ts',
      // Include the canary so it triggers this exact rule:
      'tests/eslint-canaries/ScraperCannotNewServices.canary.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...RESTRICTED_SYNTAX_RULES,
        {
          selector: 'NewExpression[callee.name=/^(TwoFactorService|TelegramNotifier|WebhookNotifier|AccountImporter|ReceiptImportHandler|ReceiptOcrService|MetricsService|TransactionService|ImportMediator|TelegramCommandHandler|TelegramPoller|NotificationService|SpendingWatchService|ReconciliationService|AuditLogService|DryRunCollector)$/]',
          message: '🚫 LAYER: Scraper code MUST NOT instantiate Integration Services. Inject the interface (e.g. ITwoFactorPrompter) via constructor opts; the composition root in src/Index.ts owns concrete wiring.',
        },
      ],
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

  // 7b. CONFIG OCP — ban `if (config.X)` dispatch chains (PR 2: registry pattern)
  // The 3 dispatchers below MUST go through IBlockValidator / INotifierFactory
  // registries. Adding a new optional section (e.g. retry) or notifier (e.g.
  // Slack) MUST be one new registry entry — never a new `if (config.X)`
  // branch in the dispatcher. Selector matches `if (config.<identifier>)`
  // exactly (single MemberExpression test), mirroring the coupling-scanner
  // regex `/if\s*\(\s*config\.[A-Za-z_][A-Za-z0-9_]*\s*\)/`.
  //
  // NOTE: Placed AFTER section 7 (canary files override) so its
  // `no-restricted-syntax` rule survives on the canary fixture; flat-config
  // rule keys are replaced (not merged) by later matching blocks, so the
  // canary file MUST be configured by the LAST block listing it.
  {
    files: [
      'src/Config/ConfigLoader.ts',
      'src/Config/ConfigLoaderValidator.ts',
      'src/Services/NotificationService.ts',
      // Include the canary so it triggers this exact rule:
      'tests/eslint-canaries/ConfigNoIfChain.canary.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...RESTRICTED_SYNTAX_RULES,
        {
          selector: "IfStatement[test.type='MemberExpression'][test.object.name='config']",
          message: '🚫 OCP: Config dispatch MUST go through BlockValidatorRegistry / NotifierRegistry. Add a registry entry, do not add an `if (config.X)` branch here.',
        },
      ],
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
      'src/Services/TelegramUpdateDispatcher.ts',
      'src/Services/Notifications/TelegramNotifier.ts',
      'src/Services/Notifications/TelegramOtpPoller.ts',
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

  // 7c. CONFIG VALIDATOR — tightened max-lines (PR 3: ConfigValidator split)
  // After splitting per-block checks into `src/Config/Validators/*Checker.ts`,
  // `ConfigValidator.ts` is now a thin orchestrator (~105 LoC). The default
  // cap is `max: 300`; this rule caps it at 200 so the orchestrator cannot
  // drift back into being a god-class. Adding a new config block MUST be a
  // new `*Checker.ts` module + one delegation line here — never an inline
  // check or helper that grows the file beyond 200 LoC.
  //
  // NOTE: Placed AFTER section 7 (canary files override) so the
  // `max-lines: 200` rule survives on the canary fixture; flat-config rule
  // keys are replaced (not merged) by later matching blocks, so the canary
  // file MUST be configured by the LAST block listing it.
  {
    files: [
      'src/Config/ConfigValidator.ts',
      'tests/eslint-canaries/ConfigValidatorMaxLines.canary.ts',
    ],
    rules: {
      'max-lines': ['error', { max: 200, skipBlankLines: true, skipComments: true }],
    },
  },

  // 7d. NOTIFICATION SERVICE — tightened max-lines (PR 4: NotificationService split)
  // After extracting `Notifications/NotificationGate.ts` (config → INotifier[])
  // and `Notifications/NotificationDispatcher.ts` (Promise.allSettled + count),
  // `NotificationService.ts` is a thin orchestrator (~60 LoC) that only wires
  // the gate and dispatcher together via 3 public send methods. The default
  // cap is `max: 300`; this rule caps it at 80 so the orchestrator cannot
  // drift back into being a god-class. Adding a new send action MUST be a
  // 5-line delegation to `dispatchToAll(...)`. Anything heavier (rate-limit,
  // dry-run gate, retry policy) MUST become a new module under
  // `src/Services/Notifications/*` — never inline in this file.
  //
  // NOTE: Placed AFTER section 7 (canary files override) so the
  // `max-lines: 80` rule survives on the canary fixture; flat-config rule
  // keys are replaced (not merged) by later matching blocks, so the canary
  // file MUST be configured by the LAST block listing it.
  {
    files: [
      'src/Services/NotificationService.ts',
      'tests/eslint-canaries/NotificationServiceMaxLines.canary.ts',
    ],
    rules: {
      'max-lines': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
    },
  },

  // 7e. TELEGRAM NOTIFIER — tightened max-lines (PR 5: TelegramNotifier split)
  // After extracting `Notifications/TelegramApiClient.ts` (raw HTTP I/O),
  // `Notifications/TelegramHtml.ts` (pure HTML/OTP utilities) and
  // `Notifications/TelegramOtpPoller.ts` (OTP long-poll state machine),
  // `TelegramNotifier.ts` is a thin orchestrator (~187 LoC) that wires
  // formatting, HTML safety, and HTTP transport. The default cap is
  // `max: 300`; this rule caps it at 200 so the orchestrator cannot drift
  // back into being a 469-LoC god-class. Adding a new send action MUST be a
  // short delegation to `this._client.sendHtmlMessage(...)`. Anything
  // heavier (rate-limit, retry policy, alternative transport) MUST become
  // a new module under `src/Services/Notifications/*` — never inline in
  // this file.
  //
  // NOTE: Placed AFTER section 7 (canary files override) so the
  // `max-lines: 200` rule survives on the canary fixture; flat-config rule
  // keys are replaced (not merged) by later matching blocks, so the canary
  // file MUST be configured by the LAST block listing it.
  {
    files: [
      'src/Services/Notifications/TelegramNotifier.ts',
      'tests/eslint-canaries/TelegramNotifierMaxLines.canary.ts',
    ],
    rules: {
      'max-lines': ['error', { max: 200, skipBlankLines: true, skipComments: true }],
    },
  },

  // 7f. TELEGRAM POLLER — tightened max-lines (PR 7: TelegramPoller split)
  // After extracting `TelegramPollHttp.ts` (long-poll HTTP wrappers),
  // `TelegramPollBackoff.ts` (pure backoff math) and
  // `TelegramUpdateDispatcher.ts` (chat-id filtering + text/photo/callback
  // routing), `TelegramPoller.ts` is a thin lifecycle + error-recovery
  // orchestrator (~160 effective LoC). The default cap is `max: 300`;
  // this rule caps it at 200 so the orchestrator cannot drift back into
  // being a 418-LoC mixed-concern class. Adding a new update kind MUST be
  // a new branch inside `TelegramUpdateDispatcher.ts`, not inline here.
  // Adding a new HTTP endpoint MUST be a new function in
  // `TelegramPollHttp.ts`, not inline here.
  //
  // NOTE: Placed AFTER section 7 (canary files override) so the
  // `max-lines: 200` rule survives on the canary fixture; flat-config rule
  // keys are replaced (not merged) by later matching blocks, so the canary
  // file MUST be configured by the LAST block listing it.
  {
    files: [
      'src/Services/TelegramPoller.ts',
      'tests/eslint-canaries/TelegramPollerMaxLines.canary.ts',
    ],
    rules: {
      'max-lines': ['error', { max: 200, skipBlankLines: true, skipComments: true }],
    },
  },

  // 7g. TELEGRAM COMMAND HANDLER — tightened max-lines (PR 8: split)
  // After extracting `TelegramImportCoordinator.ts` (scan / scanAll /
  // preview / retry pipelines + busy-state + reply helper) and
  // `TelegramQueryCommands.ts` (status / logs / watch / check-config /
  // help / import-receipt + reply helper), `TelegramCommandHandler.ts`
  // is a thin router-wiring orchestrator (~140 effective LoC). The
  // default cap is `max: 300`; this rule caps it at 200 so the
  // orchestrator cannot drift back into being a 468-LoC mixed-concern
  // class. Adding a new import-pipeline command MUST be a new method on
  // `TelegramImportCoordinator`, not inline here. Adding a new
  // read-only / informational command MUST be a new method on
  // `TelegramQueryCommands`, not inline here.
  //
  // NOTE: Placed AFTER section 7 (canary files override) so the
  // `max-lines: 200` rule survives on the canary fixture; flat-config rule
  // keys are replaced (not merged) by later matching blocks, so the canary
  // file MUST be configured by the LAST block listing it.
  {
    files: [
      'src/Services/TelegramCommandHandler.ts',
      'tests/eslint-canaries/TelegramCommandHandlerMaxLines.canary.ts',
    ],
    rules: {
      'max-lines': ['error', { max: 200, skipBlankLines: true, skipComments: true }],
    },
  },

  // 7h. IMPORTER BARREL — tightened max-lines (PR 21: Index.ts composition-root split)
  // After extracting `Importer/ConfigBootstrap.ts`, `Importer/ResilienceWiring.ts`,
  // `Importer/CoreServicesWiring.ts`, `Importer/PipelineComposition.ts`,
  // `Importer/ImporterWiring.ts`, `Importer/ProcessLifecycle.ts` and
  // `Importer/ImporterBootstrap.ts`, `src/Index.ts` is a thin barrel (~13
  // effective LoC) that only re-exports the public Importer surface and
  // calls `bootImporter()` when executed directly — identical in shape to
  // `src/Scheduler.ts`. The default cap is `max: 300`; this rule caps it
  // at 50 so the barrel cannot drift back into being the 319-LoC
  // composition root it used to be. Any new boot-time orchestration MUST
  // land in a new module under `src/Importer/*`, not inline here.
  //
  // NOTE: Placed AFTER section 7 (canary files override) so the
  // `max-lines: 50` rule survives on the canary fixture; flat-config rule
  // keys are replaced (not merged) by later matching blocks, so the canary
  // file MUST be configured by the LAST block listing it.
  {
    files: [
      'src/Index.ts',
      'tests/eslint-canaries/IndexBarrelMaxLines.canary.ts',
    ],
    rules: {
      'max-lines': ['error', { max: 50, skipBlankLines: true, skipComments: true }],
    },
  },

  // 7i. SCHEDULER CONFIG — tightened max-lines-per-function (PR #433: ConfigBootstrap decouple)
  // Establishes a precedent (per `eslint-rules-guidlines.md` §1 PRECEDENT)
  // that newly-decoupled sub-trees ship at the CLAUDE.md aspirational cap
  // of `max-lines-per-function: 10`, not the legacy global `max: 20`. The
  // current `src/Scheduler/Config/**` source has zero violations at this
  // cap — every function is <= 10 effective LoC by SRP construction
  // (ConfigFileReader was split into 4 single-responsibility helpers in
  // the preceding refactor commit).
  //
  // Any NEW function added here MUST stay at <= 10 effective LoC. Reach
  // 11+ ⇒ split into helpers in the same commit. This rule prevents the
  // SRP win in PR #433 from drifting back to a 20-LoC composite over time.
  //
  // Global tightening (the same rule for all of src/**) is tracked in
  // `hardening_todos.eslint-max-lines-per-function-tighten-10` and will
  // land as future-PR campaigns once the 246-function legacy backlog has
  // been drained. Per §3 GRANDFATHER we never use `eslint-disable`; the
  // wider tightening will reuse this `files: [...]` override mechanism.
  //
  // Backed by canary fixture
  // `tests/eslint-canaries/SchedulerConfigMaxLinesPerFunction.canary.ts`
  // (12-LoC function body) per §2 CANARY. The harness at
  // `config/check-eslint-canaries.mjs` asserts the rule fires.
  //
  // NOTE: Placed AFTER section 7 (canary files override) so the
  // `max-lines-per-function: 10` rule survives on the canary fixture;
  // flat-config rule keys are replaced (not merged) by later matching
  // blocks, so the canary file MUST be configured by the LAST block
  // listing it.
  {
    files: [
      'src/Scheduler/Config/**/*.ts',
      'tests/eslint-canaries/SchedulerConfigMaxLinesPerFunction.canary.ts',
    ],
    rules: {
      'max-lines-per-function': ['error', { max: 10, skipBlankLines: true, skipComments: true }],
    },
  },

  // 7j. SCHEDULER PROCESS — tightened max-lines-per-function (PR 20b: SchedulerProcessLifecycle decouple)
  // Extends the §7i pattern (PR #433) to the new
  // `src/Scheduler/Process/**` sub-tree introduced when
  // `process.exit` orchestration was extracted from
  // `SchedulerBootstrap.ts` into `SchedulerProcessLifecycle.ts`.
  //
  // Per `eslint-rules-guidlines.md` §1 PRECEDENT every newly-decoupled
  // sub-tree ships at the CLAUDE.md aspirational cap of
  // `max-lines-per-function: 10`. The current
  // `src/Scheduler/Process/**` source has zero violations at this cap
  // — every helper is <= 10 effective LoC by construction (each exit
  // path is a single SRP function with JSDoc-only "filler" lines).
  //
  // Any NEW function added here MUST stay <= 10 effective LoC.
  // Reach 11+ ⇒ split into helpers in the same commit. This rule
  // protects the lifecycle seam from drifting back into a 20-LoC
  // composite over time.
  //
  // Global tightening still tracked in
  // `hardening_todos.eslint-max-lines-per-function-tighten-10`.
  // Per §3 GRANDFATHER we never use `eslint-disable`; the wider
  // tightening will reuse this `files: [...]` override mechanism.
  //
  // Backed by canary fixture
  // `tests/eslint-canaries/SchedulerProcessMaxLinesPerFunction.canary.ts`
  // (12-LoC function body) per §2 CANARY. The harness at
  // `config/check-eslint-canaries.mjs` asserts the rule fires.
  //
  // NOTE: Placed AFTER section 7 (canary files override) so the
  // `max-lines-per-function: 10` rule survives on the canary fixture;
  // flat-config rule keys are replaced (not merged) by later matching
  // blocks, so the canary file MUST be configured by the LAST block
  // listing it.
  {
    files: [
      'src/Scheduler/Process/**/*.ts',
      'tests/eslint-canaries/SchedulerProcessMaxLinesPerFunction.canary.ts',
    ],
    rules: {
      'max-lines-per-function': ['error', { max: 10, skipBlankLines: true, skipComments: true }],
    },
  },

  // 7k. SERVICES/RECEIPT (PR 14 cluster) — tightened max-lines-per-function (PR 14: ReceiptOcrService decouple)
  // Extends the §7i/§7j pattern (PR #433 / PR #434) to the
  // PR-14 decoupled cluster only: the new `OcrParsing.ts` +
  // `OcrImagePreprocess.ts` sub-modules and the trimmed
  // `ReceiptOcrService.ts` orchestrator.
  //
  // Per `eslint-rules-guidlines.md` §1 PRECEDENT every newly-decoupled
  // file ships at the CLAUDE.md aspirational cap of
  // `max-lines-per-function: 10`. The 3 listed source files have
  // zero violations at this cap — every helper is <= 10 effective
  // LoC by construction. CodeRabbit PR #429 flagged
  // `readJsonOrEncrypted` for breaching the same rule because the
  // global cap was 20; we lock the boundary at 10 for every new
  // decoupled cluster to prevent that drift class entirely.
  //
  // SCOPE NOTE (per §3 GRANDFATHER): the wider
  // `src/Services/Receipt/**` tree contains 7 pre-existing
  // 11-15-LoC violations in `ReceiptImporter.ts`,
  // `ReceiptMenuPresenter.ts`, and `ReceiptPayeeMatcher.ts` (all
  // landed in earlier rows of the master plan). They are NOT in
  // PR 14's scope. Tightening for the remaining Receipt cluster
  // is tracked in
  // `hardening_todos.eslint-max-lines-per-function-tighten-10`.
  // Per §3 we never use `eslint-disable`; we keep the cap loose
  // (global 20) for those files via the absence of an override
  // here, and tighten file-by-file in dedicated PRs.
  //
  // Any NEW function added to the 3 listed files MUST stay <= 10
  // effective LoC. Reach 11+ ⇒ split into helpers in the same
  // commit. This rule protects the parsing seam from drifting back
  // into a 240-LoC monolith over time.
  //
  // Backed by canary fixture
  // `tests/eslint-canaries/ReceiptMaxLinesPerFunction.canary.ts`
  // (12-LoC function body) per §2 CANARY. The harness at
  // `config/check-eslint-canaries.mjs` asserts the rule fires.
  //
  // NOTE: Placed AFTER section 7 (canary files override) so the
  // `max-lines-per-function: 10` rule survives on the canary fixture;
  // flat-config rule keys are replaced (not merged) by later matching
  // blocks, so the canary file MUST be configured by the LAST block
  // listing it.
  {
    files: [
      'src/Services/Receipt/OcrParsing.ts',
      'src/Services/Receipt/OcrImagePreprocess.ts',
      'src/Services/ReceiptOcrService.ts',
      'tests/eslint-canaries/ReceiptMaxLinesPerFunction.canary.ts',
    ],
    rules: {
      'max-lines-per-function': ['error', { max: 10, skipBlankLines: true, skipComments: true }],
    },
  },

  // 7l. PR 15 — `max-lines-per-function: 10` for the new Bank/ 3-stage
  // cluster carved out of `ProcessAllBanksStep.ts`. PRECEDENT mirrors
  // Section 7k (PR 14): every newly-decoupled cluster ships at the
  // CLAUDE.md aspirational cap of 10 effective LoC per function so
  // the seam never drifts back into a 500-LoC monolith.
  //
  // Scope:
  //   - `src/Scrapers/Pipeline/Steps/Bank/**/*.ts` (the 5 new files:
  //     ScrapeStage / MapStage / ImportStage / Shared / Index).
  //   - `tests/eslint-canaries/ProcessAllBanksBankMaxLinesPerFunction.canary.ts`
  //     (canary fixture, 12 LoC).
  //
  // SCOPE NOTE (per §3 GRANDFATHER): the orchestrator
  // `ProcessAllBanksStep.ts` (379 LoC, 22 functions) is NOT in PR 15's
  // narrow scope — every helper there is already <= 10 effective LoC
  // by inspection (verified during the extraction), so the global cap
  // of 20 is non-binding today. A follow-up PR can flip the
  // orchestrator to the strict cap once the broader Steps/ cluster
  // is audited; tracked in
  // `hardening_todos.eslint-max-lines-per-function-tighten-10`.
  //
  // Any NEW function added to the 5 listed Bank/ files MUST stay <= 10
  // effective LoC. Reach 11+ ⇒ split into SRP helpers in the same
  // commit.
  //
  // Backed by canary fixture
  // `tests/eslint-canaries/ProcessAllBanksBankMaxLinesPerFunction.canary.ts`
  // (12-LoC function body) per §2 CANARY. The harness at
  // `config/check-eslint-canaries.mjs` asserts the rule fires.
  //
  // Placed AFTER Section 7 + Section 7k so the canary file is
  // configured by the LAST matching block (flat-config rule keys are
  // replaced, not merged).
  {
    files: [
      'src/Scrapers/Pipeline/Steps/Bank/**/*.ts',
      'tests/eslint-canaries/ProcessAllBanksBankMaxLinesPerFunction.canary.ts',
    ],
    rules: {
      'max-lines-per-function': ['error', { max: 10, skipBlankLines: true, skipComments: true }],
    },
  },

  // 7m. PR 16 — `max-lines-per-function: 10` for the new Mappers/ 4-module
  // cluster carved out of `DefaultScrapeResultMapper.ts`. PRECEDENT mirrors
  // Section 7l (PR 15) + Section 7k (PR 14): every newly-decoupled cluster
  // ships at the CLAUDE.md aspirational cap of 10 effective LoC per
  // function so the seam never drifts back toward a 175-LoC monolith.
  //
  // Scope:
  //   - `src/Scraper/Mappers/Sign.ts`, `ToCanonical.ts`, `FromLegacy.ts`,
  //     `ToLegacy.ts`, `Index.ts` (4 new modules + barrel).
  //   - `src/Scraper/Mappers/DefaultScrapeResultMapper.ts` (21-LoC
  //     orchestrator — included so the seam stays single-purpose).
  //   - `tests/eslint-canaries/MappersMaxLinesPerFunction.canary.ts`
  //     (canary fixture, 12-LoC fn body).
  //
  // The interface file `IScrapeResultMapper.ts` is excluded because it
  // contains only type declarations.
  //
  // Any NEW function added to the listed Mappers/ files MUST stay <= 10
  // effective LoC. Reach 11+ ⇒ split into SRP helpers in the same
  // commit.
  //
  // Backed by canary fixture
  // `tests/eslint-canaries/MappersMaxLinesPerFunction.canary.ts`
  // (12-LoC function body) per §2 CANARY. The harness at
  // `config/check-eslint-canaries.mjs` asserts the rule fires.
  //
  // Placed AFTER Section 7 + Section 7k + Section 7l so the canary file
  // is configured by the LAST matching block (flat-config rule keys are
  // replaced, not merged).
  {
    files: [
      'src/Scraper/Mappers/DefaultScrapeResultMapper.ts',
      'src/Scraper/Mappers/Sign.ts',
      'src/Scraper/Mappers/ToCanonical.ts',
      'src/Scraper/Mappers/FromLegacy.ts',
      'src/Scraper/Mappers/ToLegacy.ts',
      'src/Scraper/Mappers/Types.ts',
      'src/Scraper/Mappers/Index.ts',
      'tests/eslint-canaries/MappersMaxLinesPerFunction.canary.ts',
    ],
    rules: {
      'max-lines-per-function': ['error', { max: 10, skipBlankLines: true, skipComments: true }],
    },
  },

  // 10a. RECEIPT HANDLER — at max-lines limit, pending refactor to extract payee query logic
  {
    files: ['src/Services/ReceiptImportHandler.ts'],
    rules: {
      'max-lines': ['error', { max: 310, skipBlankLines: true, skipComments: true }],
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
