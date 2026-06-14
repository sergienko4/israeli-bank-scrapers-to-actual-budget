// Canary: PR 15 — must trigger `max-lines-per-function: 10`
// for src/Scrapers/Pipeline/Steps/Bank/**.
//
// The chore(eslint) commit on PR 15 adds Section 7l to
// eslint.config.mjs that tightens `max-lines-per-function` from the
// default 20 down to 10 for:
//   - src/Scrapers/Pipeline/Steps/Bank/**/*.ts
//   - tests/eslint-canaries/ProcessAllBanksBankMaxLinesPerFunction.canary.ts ← this file
//
// The function below has 12 effective body lines (11 const + 1 return,
// counted with skipBlankLines + skipComments), so the rule MUST
// report >= 1 error when this file is linted. If the rule is ever
// dead or weakened, this canary goes quiet and `npm run lint:canaries`
// fails per `eslint-rules-guidlines.md` §2 (CANARY).
//
// Any new file landing under src/Scrapers/Pipeline/Steps/Bank/** MUST
// keep every function at <= 10 effective LoC. Split into SRP helpers
// per CLAUDE.md / coding-principle-guidlines.md.
//
// The fixture body is intentionally a flat list of trivial constant
// declarations (no nested calls, no nullable returns, no console)
// so other ESLint rules stay quiet — only `max-lines-per-function`
// fires. The function is NOT exercised at runtime.

/**
 * Canary fixture body — intentionally exceeds Section 7l's 10-LoC cap.
 *
 * Contains 12 effective body lines so that ESLint's
 * `max-lines-per-function: 10` rule MUST report >= 1 error when the
 * canary is linted. The function is never executed at runtime; it
 * exists solely to keep the guardrail honest per
 * `eslint-rules-guidlines.md` §2 CANARY.
 * @returns Sum of the 11 const declarations (55), as a sanity-check
 *   integer. Not consumed by any caller — present only so the body
 *   has a meaningful return statement.
 */
export default function oversizedBankStageSample(): number {
  const a = 1;
  const b = 2;
  const c = 3;
  const d = 4;
  const e = 5;
  const f = 6;
  const g = 7;
  const h = 8;
  const i = 9;
  const j = 10;
  const k = 11;
  return a + b + c + d + e + f + g + h + i + j + k;
}
