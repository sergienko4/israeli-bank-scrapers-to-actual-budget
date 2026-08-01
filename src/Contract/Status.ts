/**
 * Contract for GET /api/status — the recent import-run history the mobile app
 * and the portal both render.
 *
 * `successRate` is the field this contract exists for. It is a percentage out
 * of 100, and an app that read it as a 0-1 fraction once rendered a flawless
 * import as "10000%". The range below makes that reading unrepresentable.
 */

import { type Static, Type } from '@sinclair/typebox';

/** One bank's outcome inside a single import run. */
export const RUN_BANK = Type.Object({
  name: Type.String({ description: 'Bank id as configured.' }),
  status: Type.String({ description: 'Outcome word recorded for the bank, e.g. "success".' }),
  duration: Type.Optional(Type.Number({ description: 'Wall time for this bank, milliseconds.' })),
  txns: Type.Number({ description: 'Transactions imported for this bank.' }),
  error: Type.Optional(Type.String({ description: 'Failure reason, when the bank failed.' })),
  reconciliationStatus: Type.Optional(
    Type.String({ description: 'Balance reconciliation outcome, when it ran.' }),
  ),
  reconciliationAmount: Type.Optional(
    Type.Number({ description: 'Difference reconciliation found, in minor units.' }),
  ),
});

/** One completed import run. */
export const RUN_ENTRY = Type.Object({
  timestamp: Type.String({ description: 'When the run finished, ISO 8601.' }),
  totalBanks: Type.Number({ description: 'Banks attempted in this run.' }),
  successfulBanks: Type.Number({ description: 'Banks that completed without error.' }),
  failedBanks: Type.Number({ description: 'Banks that failed.' }),
  totalTransactions: Type.Number({ description: 'Transactions imported across all banks.' }),
  totalDuplicates: Type.Number({ description: 'Transactions skipped as already present.' }),
  totalDuration: Type.Number({ description: 'Wall time for the whole run, milliseconds.' }),
  successRate: Type.Number({
    minimum: 0,
    maximum: 100,
    description:
      'Percentage of banks that succeeded, out of 100 — NOT a 0-1 fraction. '
      + 'A flawless run reports 100, and a run where one bank of four failed reports 75.',
  }),
  banks: Type.Array(RUN_BANK, { description: 'Per-bank outcomes, in run order.' }),
});

/** The GET /api/status 200 body. */
export const STATUS_BODY = Type.Object({
  runs: Type.Array(RUN_ENTRY, {
    description: 'Most recent runs, oldest first. Empty when nothing has run yet.',
  }),
});

/** One bank's outcome inside a single import run. */
export type RunBank = Static<typeof RUN_BANK>;

/** One completed import run. */
export type RunEntry = Static<typeof RUN_ENTRY>;

/** The GET /api/status 200 body. */
export type StatusBody = Static<typeof STATUS_BODY>;
