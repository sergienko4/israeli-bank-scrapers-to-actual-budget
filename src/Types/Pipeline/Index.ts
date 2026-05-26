/**
 * Pipeline-specific shared types for Phase-3 quarantine flow.
 *
 * These types live outside src/Types/Index.ts because they are pipeline
 * concerns (bank filtering, per-bank result accounting, metrics deltas),
 * not user-facing config shape.
 */

/** Successful per-bank import outcome captured by the partition. */
export interface IBankResult {
  readonly bankName: string;
  readonly imported: number;
  readonly skipped: number;
  readonly durationMs: number;
}

/** Stage at which a bank's per-bank pipeline failed. */
export type IBankQuarantineStage = 'scrape' | 'map' | 'import';

/** Failed per-bank import outcome with original Error preserved. */
export interface IBankQuarantineEntry {
  readonly bankName: string;
  readonly stage: IBankQuarantineStage;
  readonly error: Error;
  readonly durationMs: number;
}

/** Append-only metrics event collected during bank processing. */
export type IBankMetricsDelta =
  | { readonly kind: 'start'; readonly bankName: string }
  | {
      readonly kind: 'success';
      readonly bankName: string;
      readonly imported: number;
      readonly skipped: number;
    }
  | {
      readonly kind: 'failure';
      readonly bankName: string;
      readonly error: Error;
    };

/** Pure-function filter applied before iterating banks. */
export interface IBankFilter {
  matches(bankName: string): boolean;
}

/** Partitioned outcome of a bank-processing run. */
export interface IBankResultsState {
  readonly successful: readonly IBankResult[];
  readonly quarantined: readonly IBankQuarantineEntry[];
  readonly totalBanks: number;
}
