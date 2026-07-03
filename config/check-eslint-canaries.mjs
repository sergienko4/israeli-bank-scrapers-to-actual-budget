/**
 * ESLint Canary Verification Script
 *
 * Runs ESLint on intentionally-broken "canary" files to verify that
 * critical lint rules are still active and catching violations.
 *
 * A canary that produces zero errors means the rule it tests is dead.
 */
import { execSync } from 'node:child_process';

const CANARIES = {
  'tests/eslint-canaries/TypeBypass.canary.ts': {
    minErrors: 2,
    description: 'as-never, as-any, non-null assertion',
  },
  'tests/eslint-canaries/ReturnIntegrity.canary.ts': {
    minErrors: 1,
    description: 'void return, null return',
  },
  'tests/eslint-canaries/NestedCalls.canary.ts': {
    minErrors: 1,
    description: 'nested function calls',
  },
  'tests/eslint-canaries/AntiSleep.canary.ts': {
    minErrors: 1,
    description: 'sleep/setTimeout/delay bans',
  },
  'tests/eslint-canaries/PromiseAny.canary.ts': {
    minErrors: 1,
    description: 'Promise.any() ban',
  },
  'tests/eslint-canaries/ThrowNewError.canary.ts': {
    minErrors: 1,
    description: 'throw new Error() ban',
  },
  'tests/eslint-canaries/ForInLoop.canary.ts': {
    minErrors: 1,
    description: 'for-in loop ban',
  },
  'tests/eslint-canaries/DiscardedProcedure.canary.ts': {
    minErrors: 1,
    description: 'discarded Procedure result ban',
  },
  'tests/eslint-canaries/VoidSideEffect.canary.ts': {
    minErrors: 1,
    description: 'void return in side-effect method ban',
  },
  'tests/eslint-canaries/ScraperCannotNewServices.canary.ts': {
    minErrors: 1,
    description: 'PR 1 — Scraper layer cannot `new` Integration Services',
  },
  'tests/eslint-canaries/ConfigNoIfChain.canary.ts': {
    minErrors: 2,
    description: 'PR 2 — Config dispatch must go through registry (no `if (config.X)` chains)',
  },
  'tests/eslint-canaries/ConfigValidatorMaxLines.canary.ts': {
    minErrors: 1,
    description: 'PR 3 — ConfigValidator.ts capped at max-lines: 200 (this canary exceeds 200 LoC)',
  },
  'tests/eslint-canaries/NotificationServiceMaxLines.canary.ts': {
    minErrors: 1,
    description: 'PR 4 — NotificationService.ts capped at max-lines: 80 (this canary exceeds 80 LoC)',
  },
  'tests/eslint-canaries/TelegramNotifierMaxLines.canary.ts': {
    minErrors: 1,
    description: 'PR 5 — TelegramNotifier.ts capped at max-lines: 200 (this canary exceeds 200 LoC)',
  },
  'tests/eslint-canaries/TelegramPollerMaxLines.canary.ts': {
    minErrors: 1,
    description: 'PR 7/28 — TelegramPoller.ts + TelegramPollRecovery.ts capped at max-lines: 170 (this canary exceeds 170 LoC)',
  },
  'tests/eslint-canaries/TelegramCommandHandlerMaxLines.canary.ts': {
    minErrors: 1,
    description: 'PR 8 — TelegramCommandHandler.ts capped at max-lines: 200 (this canary exceeds 200 LoC)',
  },
  'tests/eslint-canaries/IndexBarrelMaxLines.canary.ts': {
    minErrors: 1,
    description: 'PR 21 — src/Index.ts capped at max-lines: 50 (this canary exceeds 50 LoC)',
  },
  'tests/eslint-canaries/SchedulerConfigMaxLinesPerFunction.canary.ts': {
    minErrors: 1,
    description:
      'PR 433 — src/Scheduler/Config/** capped at max-lines-per-function: 10 (this canary fn exceeds 10 LoC)',
  },
  'tests/eslint-canaries/ConfigLoadersMaxLinesPerFunction.canary.ts': {
    minErrors: 1,
    description:
      'Track A — src/Config/Loaders/** capped at max-lines-per-function: 10 (this canary fn exceeds 10 LoC)',
  },
  'tests/eslint-canaries/ConfigValidatorsMaxLinesPerFunction.canary.ts': {
    minErrors: 1,
    description:
      'Track A — src/Config/Validators/** capped at max-lines-per-function: 10 (this canary fn exceeds 10 LoC)',
  },
  'tests/eslint-canaries/ServicesAccountMaxLinesPerFunction.canary.ts': {
    minErrors: 1,
    description:
      'Track A — src/Services/Account/** capped at max-lines-per-function: 10 (this canary fn exceeds 10 LoC)',
  },
  'tests/eslint-canaries/ServicesTransactionMaxLinesPerFunction.canary.ts': {
    minErrors: 1,
    description:
      'Track A — src/Services/Transaction/** capped at max-lines-per-function: 10 (this canary fn exceeds 10 LoC)',
  },
  'tests/eslint-canaries/ServicesImportMaxLinesPerFunction.canary.ts': {
    minErrors: 1,
    description:
      'Track A — src/Services/Import/** capped at max-lines-per-function: 10 (this canary fn exceeds 10 LoC)',
  },
  'tests/eslint-canaries/ServicesTelegramMaxLinesPerFunction.canary.ts': {
    minErrors: 1,
    description:
      'Track A — src/Services/Telegram/** capped at max-lines-per-function: 10 (this canary fn exceeds 10 LoC)',
  },
  'tests/eslint-canaries/ResilienceMaxLinesPerFunction.canary.ts': {
    minErrors: 1,
    description:
      'Track A — src/Resilience/** capped at max-lines-per-function: 10 (this canary fn exceeds 10 LoC)',
  },
  'tests/eslint-canaries/SchedulerProcessMaxLinesPerFunction.canary.ts': {
    minErrors: 1,
    description:
      'PR 20b — src/Scheduler/Process/** capped at max-lines-per-function: 10 (this canary fn exceeds 10 LoC)',
  },
  'tests/eslint-canaries/ReceiptMaxLinesPerFunction.canary.ts': {
    minErrors: 1,
    description:
      'PR 14 — src/Services/Receipt/** capped at max-lines-per-function: 10 (this canary fn exceeds 10 LoC)',
  },
  'tests/eslint-canaries/ProcessAllBanksBankMaxLinesPerFunction.canary.ts': {
    minErrors: 1,
    description:
      'PR 15 — src/Scrapers/Pipeline/Steps/Bank/** capped at max-lines-per-function: 10 (this canary fn exceeds 10 LoC)',
  },
  'tests/eslint-canaries/MappersMaxLinesPerFunction.canary.ts': {
    minErrors: 1,
    description:
      'PR 16 — src/Scraper/Mappers/** capped at max-lines-per-function: 10 (this canary fn exceeds 10 LoC)',
  },
  'tests/eslint-canaries/LiveStrategyMaxLinesPerFunction.canary.ts': {
    minErrors: 1,
    description:
      'PR 19 — src/Scraper/Strategies/Live/** capped at max-lines-per-function: 10 (this canary fn exceeds 10 LoC)',
  },
  'tests/eslint-canaries/MetricsMaxLinesPerFunction.canary.ts': {
    minErrors: 1,
    description:
      'PR 18 — src/Services/Metrics/** capped at max-lines-per-function: 10 (this canary fn exceeds 10 LoC)',
  },
  'tests/eslint-canaries/SpendingWatchMaxLinesPerFunction.canary.ts': {
    minErrors: 1,
    description:
      'PR 21 — src/Services/SpendingWatch/** capped at max-lines-per-function: 10 (this canary fn exceeds 10 LoC)',
  },
  'tests/eslint-canaries/DryRunMaxLinesPerFunction.canary.ts': {
    minErrors: 1,
    description:
      'PR 22 — src/Services/DryRun/** capped at max-lines-per-function: 10 (this canary fn exceeds 10 LoC)',
  },
  'tests/eslint-canaries/OcrParsingMaxLinesPerFunction.canary.ts': {
    minErrors: 1,
    description:
      'PR 24 — src/Services/Receipt/Ocr/** capped at max-lines-per-function: 10 (this canary fn exceeds 10 LoC)',
  },
  'tests/eslint-canaries/TelegramFormatterMaxLinesPerFunction.canary.ts': {
    minErrors: 1,
    description:
      'PR 23 — src/Services/Notifications/Telegram/** capped at max-lines-per-function: 10 (this canary fn exceeds 10 LoC)',
  },
  'tests/eslint-canaries/TypesIndexMaxLines.canary.ts': {
    minErrors: 1,
    description:
      'PR 25 (Types barrel split) — src/Types/** capped at max-lines: 80 (this canary file exceeds 80 LoC)',
  },
  'tests/eslint-canaries/WebhookFormatterMaxLinesPerFunction.canary.ts': {
    minErrors: 1,
    description:
      'PR 26 — src/Services/Notifications/Webhook/** capped at max-lines-per-function: 10 (this canary fn exceeds 10 LoC)',
  },
  'tests/eslint-canaries/ReceiptImportHandlerMaxLines.canary.ts': {
    minErrors: 1,
    description:
      'PR 27 — ReceiptImportHandler.ts + Receipt/ReceiptImportFlow.ts capped at max-lines: 200 (this canary exceeds 200 LoC)',
  },
  'tests/eslint-canaries/GlobalSourceMaxLines.canary.ts': {
    minErrors: 1,
    description:
      'Global src/** default max-lines tightened 300 -> 200 (size/cohesion Track B); this canary exceeds 200 LoC',
  },
  'tests/eslint-canaries/UnneededTernary.canary.ts': {
    minErrors: 1,
    description:
      'PR 492 — no-unneeded-ternary (SonarCloud S6644): `x ? x : y` must be `x || y`',
  },
  'tests/eslint-canaries/RegExpTemplateRaw.canary.ts': {
    minErrors: 1,
    description:
      'PR 492 — RegExp-from-template must use String.raw (SonarCloud S7780): no doubled backslashes',
  },
  'tests/eslint-canaries/portal/TopLevelAwait.canary.js': {
    minErrors: 1,
    config: 'config/eslint.portal-public.mjs',
    description:
      'PR 492 — portal SPA top-level call must be awaited (SonarCloud S7785): app.js loads as <script type="module"> with `await init()`',
  },
};

let allPassed = true;
let passCount = 0;
let failCount = 0;

for (const [file, expected] of Object.entries(CANARIES)) {
  const configFlag = expected.config ? `--config "${expected.config}" ` : '';
  try {
    execSync(`npx eslint ${configFlag}"${file}" --format json`, {
      encoding: 'utf8',
      cwd: process.cwd(),
    });
    // If eslint exits 0, no errors found -- rule is dead!
    console.error(
      `DEAD RULE: ${file} (${expected.description}) should have errors but ESLint found none`,
    );
    allPassed = false;
    failCount++;
  } catch (e) {
    // ESLint exits 1 when it finds errors -- this is EXPECTED for canaries
    let errorCount = 0;
    try {
      const output = JSON.parse(e.stdout);
      errorCount = output[0]?.errorCount ?? 0;
    } catch {
      // JSON parse failed -- ESLint may have crashed
      console.error(`CRASH: ${file} -- ESLint did not produce valid JSON output`);
      console.error(e.stderr || e.stdout || e.message);
      allPassed = false;
      failCount++;
      continue;
    }

    if (errorCount >= expected.minErrors) {
      console.log(
        `PASS: ${file}: ${errorCount} errors (expected >= ${expected.minErrors}) [${expected.description}]`,
      );
      passCount++;
    } else {
      console.error(
        `WEAK RULE: ${file}: only ${errorCount} errors (expected >= ${expected.minErrors}) [${expected.description}]`,
      );
      allPassed = false;
      failCount++;
    }
  }
}

console.log(`\n--- Results: ${passCount} passed, ${failCount} failed ---`);

if (!allPassed) {
  console.error('\nSome ESLint canary rules are dead or weak');
  process.exit(1);
}
console.log('\nAll ESLint canary rules are active');
