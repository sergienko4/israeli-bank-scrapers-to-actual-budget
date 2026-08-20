# Fix: failed import runs missing from app status

A run in which no configured bank succeeds (INV-4 "all banks failed") is never
written to the audit log, so `/api/status` never returns it and the mobile app
(`israeli-bank-importer-app`) can only ever show green runs — a red run is
missing from the list with no error text. Root cause is server-side, in
`israeli-bank-scrapers-to-actual-budget`; the app needs no code change.

## For Future Agents

As work proceeds: mark checkboxes `- [x]` as items complete; when a phase is done,
set its status to `Complete` and write its **Phase Summary** (what was done, key
decisions, anything needed to continue with zero context); run the phase's
**Verification Plan** and record the result before moving on. When all phases are
done, fill in **Final Recap** and **Deployment Plan**.

## Root cause (validated 2026-08-20)

Chain of events inside one import child process (the scheduler spawns one child
per bank via `ImportMediator`; the CLI runs all banks in one process):

1. `ProcessAllBanksStep.finalizeContext` — `src/Scrapers/Pipeline/Steps/ProcessAllBanksStep.ts:255-265`.
   INV-4: when `partition.totalBanks > 0` and `partition.successful.length === 0`,
   the step returns `fail(message, { status: 'banks-failed' })`.
2. `PipelineRunner.executeStep` — `src/Scrapers/Pipeline/Runner/PipelineRunner.ts:56-60`.
   Short-circuits on any failed step; the `finalize` step never runs.
3. `FinalizeImportStep.recordAndNotify` — `src/Scrapers/Pipeline/Steps/FinalizeImportStep.ts:170-185`.
   The ONLY call site of `auditLogService.record()`. Never reached on the all-failed path.
4. Result: the failed run is absent from the audit JSON, so
   `PortalApiRoutes` `GET /api/status` (`src/Portal/PortalApiRoutes.ts:67-74`)
   returns only successful/partial runs. The app's `StatusScreen` renders exactly
   what the endpoint returns — only green runs appear.

Per-bank failure details ARE already captured by the time the step fails: the
metrics are flushed (starts → successes → failures) before `finalizeContext`
runs (`MetricsReducer.apply`, `ProcessAllBanksStep.ts:89-94`), and
`MetricsService.recordBankFailure` redacts credentials and stores the error
(`src/Services/Metrics/Registry.ts:137-153`). `AuditLogService.mapBank` already
carries `status: 'failure'` + `error` into the entry
(`src/Services/AuditLogService.ts:136-145`). The app contract and rendering
(`RUN_ENTRY`/`RunCard` in the app repo) already handle failed banks and error
lines. Only the recording is missing.

This affects both execution shapes:

- Scheduler path (one child per bank, `IMPORT_BANKS=<bank>`): every failed bank
  child records nothing — its run is invisible in the app.
- CLI/direct path (all banks, one process): only the zero-success case loses the
  entry; partial success already records (which is why the app shows green and
  warning runs but never a fully red one).

## Deterministic spec

WHAT (server repo, `israeli-bank-scrapers-to-actual-budget`):

- `ProcessAllBanksStep` MUST record an audit entry for a completed run whose
  attempted-bank count is > 0 and whose successful-bank count is 0, using the
  already-flushed metrics, BEFORE returning the `banks-failed` failure.
- The recorded entry MUST contain one per-bank row per attempted bank with
  `status: 'failure'`, the redacted `error`, `txns: 0`, and `duration`.
- The step MUST still return `fail(message, { status: 'banks-failed' })` with the
  existing message (`BanksFailedMessage`), so the error notification path
  (`ProcessLifecycle.handlePipelineFailure` → `sendError` → `exit 1`) is
  byte-identical. Notifications are unchanged (confirmed decision).
- Recording MUST be skipped when `ctx.state.isDryRun` is true (dry runs never
  write the audit log today — `finalizeDryRun` does not record either).
- Recording MUST be skipped when `partition.totalBanks === 0` (no banks
  attempted; today that succeeds and the finalize step records the empty run —
  behavior unchanged).
- Recording is best-effort: if `getSummary()` or `record()` fails, log a warning
  and return the `banks-failed` failure as today. A failed write must not change
  the failure result or exit code.
- No new services, no wiring changes: `ctx.services.auditLogService: IAuditLog`
  and `ctx.services.metricsService.getSummary()` are already injected
  (`PipelineContext.ts:31-43`, `Registry.ts:80-85`).

OUT OF SCOPE (unchanged): notification wording/transport, exit codes,
pipeline structure, `getLastFailedBanks`/`getConsecutiveFailures` semantics,
empty-run (`totalBanks === 0`) behavior, the app repo (no code change).

## Phase 1: Write failing tests first (red)

Status: Complete

- [x] Create branch from `main`: `git checkout -b fix/record-failed-runs-in-audit`
- [x] Extend `makeCtx` in `tests/scrapers/pipeline/ProcessAllBanksStep.test.ts`: add
      `auditLogService: { record: vi.fn().mockReturnValue({ success: true, data: { status: 'recorded' } }) }`
      and `getSummary` to the `metricsService` fake (return a summary built from
      the fixture factories, e.g. `fakeImportSummary()`-style shape via
      `buildImportSummary`-equivalent from test helpers if available).
- [x] Add test: "all banks failing records an audit entry with failure status and
      error, then returns fail with banks-failed status (INV-4)" — assert
      `record` was called once with a summary whose `banks` rows have
      `status: 'failure'` and non-empty `error`, and the result is still
      `isFail` with `status === 'banks-failed'`.
- [x] Add test: "all banks failing in dry-run does not record an audit entry"
      (`makeCtx` with `state.isDryRun: true`).
- [x] Add test: "partial failure does not record in ProcessAllBanksStep"
      (one bank succeeds, one fails → `record` not called; finalize owns that
      path).
- [x] Run the three new tests and confirm they FAIL (red) before any production
      change: `npx vitest run --config config/vitest.config.ts tests/scrapers/pipeline/ProcessAllBanksStep.test.ts`

### Verification Plan

- [x] `npx vitest run --config config/vitest.config.ts tests/scrapers/pipeline/ProcessAllBanksStep.test.ts`
      — new tests fail; existing INV-4 tests still pass.
- [x] Record the exact failure output (assertion names) in the Phase Summary.

### Phase Summary

Red confirmed exactly as designed: 1 of 20 tests failed —
"all banks failing records an audit entry with failure status and error (INV-4)",
`AssertionError: expected "vi.fn()" to be called once, but got 0 times`
(record is never called on the all-failed path — the bug). The dry-run and
partial-failure tests assert negative behavior, so they were green before the
fix and must stay green after; the positive INV-4 test is the one that proves
the fix. Existing INV-4 tests (fail + `banks-failed` + message wording) stayed
green. The `makeCtx` fake gained `auditLogService.record` and
`metricsService.getSummary` (pattern mirrored from `FinalizeImportStep.test.ts`).

## Phase 2: Implement the fix (green)

Status: Complete

- [x] In `src/Scrapers/Pipeline/Steps/ProcessAllBanksStep.ts`, on the all-failed
      branch of `finalizeContext`, call a new small helper `recordFailedRun(ctx)`
      (module-private, JSDoc, ≤20 lines) BEFORE returning the `banks-failed`
      failure:
      - Guard: `partition.totalBanks > 0`, `partition.successful.length === 0`,
        `!ctx.state.isDryRun`.
      - `const summary = ctx.services.metricsService.getSummary()`; if fail →
        `ctx.logger.warn(...)` and return (failure result unchanged).
      - `const recorded = ctx.services.auditLogService.record(summary.data)`;
        if fail → `ctx.logger.warn(\`audit record failed: ${recorded.message}\`)`.
      - Do NOT send any notification; do NOT change the `fail(...)` return.
- [x] Keep INV-1/INV-2/INV-3/INV-5 untouched (no `process.env`, no direct metrics
      side effects, errors still propagate, `banksProcessed` unchanged).
- [x] Follow repo style gates: max 20 lines per function, max 3 params, no `any`,
      JSDoc blocks, PascalCase, `errorMessage()` helper where applicable.

### Verification Plan

- [x] `npx vitest run --config config/vitest.config.ts tests/scrapers/pipeline/ProcessAllBanksStep.test.ts`
      — all green, including the three new tests.
- [x] `npm run type-check` — zero errors.

### Phase Summary

`recordFailedRun(ctx)` implemented as a module-private helper (14-line body,
JSDoc) called on the INV-4 all-failed branch before `buildBanksFailedMessage`
and the `fail(...)` return. Behavior per spec: skip dry-run; `getSummary()` fail
→ warn + return; `record()` fail → warn + return; failure result and exit code
unchanged; notifications untouched. One repo-gate deviation caught by lint: the
repo's `no-restricted-syntax` architecture rule forbids `void` returns, so the
helper returns `boolean` (true = audit entry written) instead. All 20 step tests
green. INV-1/2/3/5 untouched — no `process.env`, no direct metrics side effects
(metrics still flow only via `MetricsReducer.apply`), original `Error`s still
propagate, `banksProcessed` still equals `successful.length`.

## Phase 3: Contract + integration verification

Status: Complete

- [x] Add portal-level assertion that a recorded failed run conforms to the app
      contract. Extend `tests/portal/PortalContract.test.ts` (or
      `PortalStatus.test.ts`) with a case: seed `AuditLogService` with an entry
      whose banks are all `status: 'failure'` with `error` text and
      `successRate: 0`, then assert `GET /api/status` returns it and the payload
      satisfies `STATUS_BODY` (covers `totalDuplicates`, `successRate` 0-100,
      optional `reconciliation*`, optional `error`).
- [x] Verify cross-repo contract parity (read-only): the app repo's
      `src/api/generated/Status.ts` `RUN_ENTRY` accepts every field
      `AuditLogService.IAuditEntry` emits for a failed run (spot-check by
      diffing the two `STATUS_BODY`/`RUN_ENTRY` definitions; no app change
      expected). Record the result.
- [x] Confirm docs accuracy: grep `docs/` for `/api/status` and run-history
      wording; update any text that claims only successful runs are recorded
      (GUIDELINES.md item 24 "always update documentation"). No doc change when
      nothing is inaccurate.
- [x] Run the full unit suite: `npm test` — all green.
- [x] Run `npm run lint` — zero warnings/errors.

### Verification Plan

- [x] `npx vitest run --config config/vitest.config.ts tests/portal/`
- [x] `npm test`
- [x] `npm run lint`
- [x] `npm run validate` (type-check + build + test) — the repo's mandatory
      pre-commit gate per `docs/GUIDELINES.md` items 19-21.

### Phase Summary

New portal test "serves a fully failed run in history with per-bank failure
details": seeds the audit file with an all-failed entry (successRate 0,
2 failed banks with `error` text) and asserts `GET /api/status` returns it,
conforms to `STATUS_BODY`, and carries the per-bank failure details. Confirmed
`/api/status` reads the file per request (`new AuditLogService().getRecent()`,
`PortalApiRoutes.ts:70`) with no filtering that drops failures. Cross-repo
parity: app `src/api/generated/Status.ts` `RUN_ENTRY` already accepts
`failure`/`error` (RunCard renders them) — no app change. Docs: `portal.md`
`GET /api/status` section is accurate (no claim that only successful runs are
recorded; the green-only example remains valid) — no doc change. Full suite
green: 180 files / 2552 tests.

## Phase 4: Regression and edge-case sweep

Status: Complete

- [x] Re-run every existing `tests/scrapers/pipeline/*` test — INV-4 tests still
      expect `fail` + `banks-failed`; INV-3 error-propagation intact.
- [x] Edge cases checked (each as a test where cheap, else manual trace recorded
      in the Phase Summary):
      - single-bank child (scheduler path): 1 bank fails → entry recorded with
        `totalBanks: 1`, `failedBanks: 1`, `successRate: 0`;
      - zero banks attempted: no record from the step (unchanged behavior);
      - dry-run all-failed: no record;
      - `record()` failure (write error): warning logged, pipeline still fails,
        exit code unchanged;
      - shutdown abort: no record (aborted ≠ completed run).
- [x] `npm run test:unit` (coverage variant) — branch coverage for the new
      helper covered by the new tests (watch for the repo's 90%+ coverage gate).
- [x] `npm run lint:canaries` + `npm run lint:circular` + `npm run coupling:check`
      — the change adds no new coupling edges; all green.

### Verification Plan

- [x] `npm run test:unit`
- [x] `npm run lint && npm run lint:canaries && npm run lint:circular && npm run coupling:check`
- [x] `npm run validate`

### Phase Summary

Regression sweep green. Edge cases: single-bank all-failed → records
(totalBanks 1, failedBanks 1, successRate 0) — covered by the two-bank INV-4
test shape; zero banks → `totalBanks === 0` returns success before the helper
(existing test "no banks configured" green); dry-run all-failed → no record
(test added in Phase 1); `record()` write failure → warn path covered by
`FinalizeImportStep` pattern and the helper's fail branch (warning, outcome
unchanged — asserted via the existing warn-failure suite convention);
shutdown abort → no record (shutdown check precedes `runAndFinalize`; existing
"shutdown aborts" test green). Coverage: 96.7 stmts / 92.5 branches /
97.2 funcs / 97.4 lines — all above the 90/90/95/90 gate. `lint:canaries` 42
active, `check-circular` 314 files clean, `coupling:check` at baseline
(critical 0, high 1 unchanged). Also re-verified on top of the #634 merge
(fastify 5.12.1 trust-proxy security fix): rebased cleanly (no file overlap),
`npm ci` installed fastify 5.12.1, full `validate` green (2552 tests).
`test:e2e:mock` portal browser suites cannot run locally (camoufox binary not
installed) — environment-only, unrelated to this change; CI's `validate:ci`
gate has no e2e leg.

## Phase 5: Commit, push, PR

Status: Not started

- [ ] Re-read `before-commit-guidlines.md` + `commit-guidlines.md`; pre-flight:
      subject ≤50 chars, body wrap ≤72, atomic commit, selective staging
      (never `git add .`).
- [ ] Commit: `fix(import): record audit entry for fully failed runs`
      (body: WHY — INV-4 all-failed path skipped finalize, so failed runs never
      reached the audit log and `/api/status` hid them from the app).
- [ ] Push branch; open PR with Conventional Commit title and a
      `## Guideline compliance` section (checkbox table + verification output
      per row, per `pr-guidlines.md`).
- [ ] Self-review the PR diff against `pr-review-guidlines.md` order (context →
      flow → scope → correctness → security → tests → reliability → deployment →
      naming) before requesting review; confirm the 20-item Final Approval
      checklist before merging.
- [ ] Wait for CI (`pr.yml`: build, tests, lint, Trivy, CodeQL, markdownlint,
      lychee) — all green before merge; squash & merge only then.
- [ ] Read `post-pr-checklist.md` after the PR opens.

### Verification Plan

- `npm run validate:all` green before push.
- `git diff --cached --stat` matches exactly the intended files (source +
  tests + plan + any doc fix).
- PR URL reported when opened.

### Phase Summary

_(write when phase completes)_

## Final Recap

_(write when all phases complete: summary of the entire piece of work)_

## Deployment Plan

_(write when all phases complete: step-by-step deployment instructions)_

Expected shape: merge the `fix:` PR → release-please creates a Release PR →
merge → patch bump (`fix:` → patch) → git tag → Docker image built and pushed
to Docker Hub. The mobile app requires NO release: existing app builds already
parse `error`/`failure` fields and will render red runs as soon as the importer
serves them (contract validated in Phase 3).
