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
};

let allPassed = true;
let passCount = 0;
let failCount = 0;

for (const [file, expected] of Object.entries(CANARIES)) {
  try {
    execSync(`npx eslint "${file}" --format json`, {
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
