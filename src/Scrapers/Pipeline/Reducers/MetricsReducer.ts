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
import { isFail, succeed } from '../Index.js';

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
  if (isFail(result)) return result;
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
  if (isFail(result)) return result;
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
  if (isFail(result)) return result;
  return succeed({ flushed: 1 });
}

/** Bundle for the recursive {@link foldFlush} helper (keeps params ≤ 3). */
interface IFoldOpts {
  readonly deltas: readonly IBankMetricsDelta[];
  readonly service: IMetricsServiceForReduce;
  readonly flusher: DeltaFlusher;
}

/**
 * Folds a per-delta flusher over the delta list with short-circuit on failure.
 *
 * Iterates via recursion (not Array.reduce) so we can guard the side-effecting
 * `flusher(delta, service)` call BEHIND the prior-failure check — passing a
 * named binary function to .reduce() invokes the flusher eagerly per element
 * even after the accumulator has already failed (SonarCloud S7727).
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
  const opts: IFoldOpts = { deltas, service, flusher };
  return foldFlush(opts, 0, seed);
}

/**
 * Recursively folds the delta list, short-circuiting on prior failure
 * BEFORE invoking the side-effecting flusher for the current index.
 * @param opts - Bundle of deltas, service, and flusher (≤ 3 params rule).
 * @param index - Current iteration index into `opts.deltas`.
 * @param acc - Accumulated Procedure (success carries running flushed count).
 * @returns Aggregate flushed count or first failure encountered.
 */
function foldFlush(
  opts: IFoldOpts, index: number, acc: Procedure<IFlushResult>,
): Procedure<IFlushResult> {
  if (index >= opts.deltas.length) return acc;
  if (isFail(acc)) return acc;
  const delta = opts.deltas[index];
  const next = opts.flusher(delta, opts.service);
  if (isFail(next)) return next;
  const total = acc.data.flushed + next.data.flushed;
  const merged = succeed({ flushed: total });
  return foldFlush(opts, index + 1, merged);
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
