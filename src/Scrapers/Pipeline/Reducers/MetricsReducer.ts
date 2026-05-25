/**
 * MetricsReducer — pure accumulator for IBankMetricsDelta events.
 *
 * Pipeline Steps NEVER call MetricsService directly (INV-2). They emit
 * IBankMetricsDelta values into an IMetricsAcc; the step's last action
 * flushes the accumulator with apply(), which is the single side-effect
 * site for per-bank metrics. The flush order (starts → successes →
 * failures) matches the legacy direct-call sequence so that
 * MetricsService observable behavior is byte-identical (INV-6).
 */

import type { IBankMetricsDelta, Procedure } from '../Index.js';
import { fail, isFail, succeed } from '../Index.js';

/** Minimal MetricsService surface required by apply(). */
export interface IMetricsServiceForReduce {
  startBank(bankName: string): Procedure<{ status: 'tracking' }>;
  recordBankSuccess(
    bankName: string, imported: number, skipped: number,
  ): Procedure<{ status: 'recorded' }>;
  recordBankFailure(
    bankName: string, error: Error,
  ): Procedure<{ status: 'recorded' }>;
}

/** Immutable accumulator of metrics deltas. */
export interface IMetricsAcc {
  readonly deltas: readonly IBankMetricsDelta[];
}

/** Result of flushing the accumulator to MetricsService. */
export interface IFlushResult {
  readonly flushed: number;
}

/** Per-delta flusher signature used by flushAll. */
type DeltaFlusher = (
  delta: IBankMetricsDelta, service: IMetricsServiceForReduce,
) => Procedure<IFlushResult>;

/** Empty starting accumulator. */
export const EMPTY: IMetricsAcc = { deltas: [] };

/**
 * Appends one delta to the accumulator without mutation.
 * @param acc - Current accumulator (frozen).
 * @param delta - New metrics event to append.
 * @returns New accumulator with the delta appended at the tail.
 */
export function reduce(
  acc: IMetricsAcc, delta: IBankMetricsDelta,
): IMetricsAcc {
  return Object.freeze({ deltas: [...acc.deltas, delta] });
}

/**
 * Flushes a single start-delta. No-op for other kinds.
 * @param delta - Delta to consider.
 * @param service - Metrics sink.
 * @returns Success with flushed=1 when applied, flushed=0 when skipped.
 */
function flushStart(
  delta: IBankMetricsDelta, service: IMetricsServiceForReduce,
): Procedure<IFlushResult> {
  if (delta.kind !== 'start') return succeed({ flushed: 0 });
  const result = service.startBank(delta.bankName);
  if (isFail(result)) return fail(result.message);
  return succeed({ flushed: 1 });
}

/**
 * Flushes a single success-delta. No-op for other kinds.
 * @param delta - Delta to consider.
 * @param service - Metrics sink.
 * @returns Success with flushed=1 when applied, flushed=0 when skipped.
 */
function flushSuccess(
  delta: IBankMetricsDelta, service: IMetricsServiceForReduce,
): Procedure<IFlushResult> {
  if (delta.kind !== 'success') return succeed({ flushed: 0 });
  const result = service.recordBankSuccess(
    delta.bankName, delta.imported, delta.skipped,
  );
  if (isFail(result)) return fail(result.message);
  return succeed({ flushed: 1 });
}

/**
 * Flushes a single failure-delta. No-op for other kinds.
 * @param delta - Delta to consider.
 * @param service - Metrics sink.
 * @returns Success with flushed=1 when applied, flushed=0 when skipped.
 */
function flushFailure(
  delta: IBankMetricsDelta, service: IMetricsServiceForReduce,
): Procedure<IFlushResult> {
  if (delta.kind !== 'failure') return succeed({ flushed: 0 });
  const result = service.recordBankFailure(delta.bankName, delta.error);
  if (isFail(result)) return fail(result.message);
  return succeed({ flushed: 1 });
}

/**
 * Folds a per-delta flusher over the delta list with short-circuit on failure.
 * Uses Array.reduce to avoid for-loop + nested-if depth violations.
 * @param deltas - Full delta list (filter happens per-flusher).
 * @param service - Metrics sink shared by all flushers.
 * @param flusher - Per-delta flusher (decides applies vs. skips).
 * @returns Aggregate flushed count or first failure.
 */
function flushAll(
  deltas: readonly IBankMetricsDelta[],
  service: IMetricsServiceForReduce,
  flusher: DeltaFlusher,
): Procedure<IFlushResult> {
  const seed: Procedure<IFlushResult> = succeed({ flushed: 0 });
  /**
   * Per-iteration reducer combining the running flush total with the next delta's outcome.
   * @param acc - Accumulated Procedure carrying the running flush count or first failure.
   * @param delta - Next metrics delta to consider for flushing.
   * @returns Procedure with updated flush count, or the first failure encountered.
   */
  const folder = (
    acc: Procedure<IFlushResult>, delta: IBankMetricsDelta,
  ): Procedure<IFlushResult> => {
    const next = flusher(delta, service);
    return combineFlush(acc, next);
  };
  return deltas.reduce<Procedure<IFlushResult>>(folder, seed);
}

/**
 * Combines an accumulator with the next per-delta flush result.
 * @param acc - Accumulated Procedure so far.
 * @param next - Next per-delta result to fold in.
 * @returns Either the first failure encountered, or the cumulative count.
 */
function combineFlush(
  acc: Procedure<IFlushResult>, next: Procedure<IFlushResult>,
): Procedure<IFlushResult> {
  if (isFail(acc)) return acc;
  if (isFail(next)) return next;
  return succeed({ flushed: acc.data.flushed + next.data.flushed });
}

/**
 * Flushes the accumulator to the MetricsService in spec-locked order:
 * starts → successes → failures.
 * @param acc - Accumulator collected during bank processing.
 * @param service - Side-effect sink.
 * @returns Aggregate flushed count or the first failure encountered.
 */
export function apply(
  acc: IMetricsAcc, service: IMetricsServiceForReduce,
): Procedure<IFlushResult> {
  const starts = flushAll(acc.deltas, service, flushStart);
  if (isFail(starts)) return starts;
  const successes = flushAll(acc.deltas, service, flushSuccess);
  if (isFail(successes)) return successes;
  const failures = flushAll(acc.deltas, service, flushFailure);
  if (isFail(failures)) return failures;
  const total = starts.data.flushed + successes.data.flushed + failures.data.flushed;
  return succeed({ flushed: total });
}
