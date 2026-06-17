import type {
  IBankMetricsDelta,
  IBankQuarantineEntry,
  IBankResult,
  IProcedureFailure,
  IProcedureSuccess,
  Procedure,
} from '../../Index.js';
import { succeed } from '../../Index.js';
import type { IMetricsAcc } from '../../Reducers/MetricsReducer.js';
import * as MetricsReducer from '../../Reducers/MetricsReducer.js';
import { stageFromStatus } from './Index.js';

/**
 * Run mutator contract — accumulates metrics + quarantine during bank iteration.
 */
export interface IRunMutator {
  /**
   * Records a metrics delta into the in-memory accumulator.
   * @param delta - Metrics delta event.
   * @returns Recorded acknowledgement.
   */
  reduce(delta: IBankMetricsDelta): Procedure<{ recorded: true }>;
  /**
   * Appends a quarantine entry to the run's collection.
   * @param entry - Quarantine entry to append.
   * @returns Recorded acknowledgement.
   */
  addQuarantine(entry: IBankQuarantineEntry): Procedure<{ recorded: true }>;
  /**
   * Returns the current metrics accumulator snapshot.
   * @returns Current IMetricsAcc.
   */
  getMetrics(): IMetricsAcc;
  /**
   * Returns the current quarantine array (readonly view).
   * @returns Current quarantine entries.
   */
  getQuarantine(): readonly IBankQuarantineEntry[];
}

/**
 * Creates a fresh run mutator with empty state.
 * @returns Frozen IRunMutator instance.
 */
export function createMutator(): IRunMutator {
  let metrics: IMetricsAcc = MetricsReducer.EMPTY;
  const quarantine: IBankQuarantineEntry[] = [];
  return Object.freeze({
    /**
     *
     * @param delta
     */
    reduce: (delta: IBankMetricsDelta): Procedure<{ recorded: true }> => {
      metrics = MetricsReducer.reduce(metrics, delta);
      return succeed({ recorded: true as const });
    },
    /**
     *
     * @param entry
     */
    addQuarantine: (
      entry: IBankQuarantineEntry,
    ): Procedure<{ recorded: true }> => {
      quarantine.push(entry);
      return succeed({ recorded: true as const });
    },
    /**
     *
     */
    getMetrics: (): IMetricsAcc => metrics,
    /**
     *
     */
    getQuarantine: (): readonly IBankQuarantineEntry[] => quarantine,
  });
}

/**
 * Records a successful bank result via a 'success' delta.
 * @param mutator - Run mutator.
 * @param outcome - Successful Procedure carrying the IBankResult.
 * @param bankName - Bank name for the delta payload.
 * @returns The outcome unchanged.
 */
export function recordSuccess(
  mutator: IRunMutator,
  outcome: IProcedureSuccess<IBankResult>,
  bankName: string,
): Procedure<IBankResult> {
  mutator.reduce({
    kind: 'success',
    bankName,
    imported: outcome.data.imported,
    skipped: outcome.data.skipped,
  });
  return outcome;
}

/**
 * Options for recordQuarantine.
 */
export interface IRecordQuarantineOpts {
  readonly bankName: string;
  readonly start: number;
  readonly outcome: IProcedureFailure;
}

/**
 * Records a quarantined bank — pushes entry + emits 'failure' delta.
 * Preserves original Error reference end-to-end (INV-3).
 * @param mutator - Run mutator.
 * @param opts - Quarantine recording options.
 * @returns The outcome unchanged (strategy logs + skips).
 */
export function recordQuarantine(
  mutator: IRunMutator,
  opts: IRecordQuarantineOpts,
): Procedure<IBankResult> {
  const { bankName, start, outcome } = opts;
  const stage = stageFromStatus(outcome.status);
  const error = outcome.error ?? new Error(outcome.message);
  const entry: IBankQuarantineEntry = Object.freeze({
    bankName,
    stage,
    error,
    durationMs: Date.now() - start,
  });
  mutator.addQuarantine(entry);
  mutator.reduce({
    kind: 'failure',
    bankName,
    error,
  });
  return outcome;
}
