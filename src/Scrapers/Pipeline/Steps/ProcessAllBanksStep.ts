/**
 * Pipeline step: process all configured banks with quarantine semantics.
 *
 * Phase-3 invariants:
 *   INV-1  No process.env reads (uses ctx.config.bankFilter).
 *   INV-2  No direct MetricsService side-effects (uses MetricsReducer).
 *   INV-3  Original Error objects propagate end-to-end.
 *   INV-4  All-banks-fail → fail; partial → succeed.
 *   INV-5  state.banksProcessed === state.bankResults.successful.length.
 *
 * The 3 stages (scrape → map → import) live in `./Bank/` after the
 * PR 15 split; this file owns the orchestrator + bank-entry iteration
 * + run-result assembly.
 */

import type {
  IBankConfig,
  IBankResult, IBankResultsState,
  IPipelineContext,
  PipelineStep, Procedure,
} from '../Index.js';
import { fail, isFail, succeed } from '../Index.js';
import type { IMetricsAcc } from '../Reducers/MetricsReducer.js';
import * as MetricsReducer from '../Reducers/MetricsReducer.js';
import type { IPaginationStrategy } from '../Strategies/IPaginationStrategy.js';
import createSequentialStrategy from '../Strategies/SequentialPaginationStrategy.js';
import type { IRunMutator } from './Bank/BankRunRecorder.js';
import {
  createMutator, recordQuarantine, recordSuccess,
} from './Bank/BankRunRecorder.js';
import type { IBankEntry, IBankOpts } from './Bank/Index.js';
import {
  importStage, mapStage, scrapeStage,
} from './Bank/Index.js';

/** Bundle for the pagination iteration helper (keeps params ≤ 3). */
interface IIterateOpts {
  readonly ctx: IPipelineContext;
  readonly entries: readonly IBankEntry[];
  readonly strategy: IPaginationStrategy<IBankEntry, IBankResult>;
  readonly mutator: IRunMutator;
}

/** Output of the bank-iteration loop. */
interface IRunResult {
  readonly partition: IBankResultsState;
  readonly metricsAcc: IMetricsAcc;
}

/**
 * Creates a step that scrapes+imports all banks with quarantine semantics.
 * @returns PipelineStep processing banks via the sequential strategy.
 */
export default function createProcessAllBanksStep(): PipelineStep {
  return innerStep;
}

/**
 * Inner step closure: init metrics, then run banks and finalize ctx.
 * @param ctx - Pipeline context.
 * @returns Procedure with updated context, or fail.
 */
async function innerStep(
  ctx: IPipelineContext,
): ReturnType<PipelineStep> {
  if (ctx.shutdownHandler.isShuttingDown()) {
    return fail('Pipeline aborted: shutdown requested', { status: 'shutdown' });
  }
  ctx.logger.info('Processing all banks...');
  const init = ctx.services.metricsService.startImport();
  if (isFail(init)) {
    return fail('metrics init failed', { status: 'metrics-init-failed' });
  }
  return await runAndFinalize(ctx);
}

/**
 * Runs the bank flow, flushes metrics, and finalizes the context.
 * @param ctx - Pipeline context.
 * @returns Procedure with updated context.
 */
async function runAndFinalize(
  ctx: IPipelineContext,
): Promise<Procedure<IPipelineContext>> {
  const entries = buildBankEntries(ctx);
  const run = await runBanks(ctx, entries);
  if (isFail(run)) return run;
  const flush = MetricsReducer.apply(
    run.data.metricsAcc, ctx.services.metricsService,
  );
  if (isFail(flush)) {
    return fail(flush.message, { status: 'metrics-flush-failed' });
  }
  return finalizeContext(ctx, run.data.partition);
}

/**
 * Filters configured banks via the resolved IBankFilter (INV-1).
 * @param ctx - Pipeline context.
 * @returns Filtered bank entries.
 */
function buildBankEntries(
  ctx: IPipelineContext,
): readonly IBankEntry[] {
  const all = mapEntries(ctx.config.banks);
  return all.filter((entry: IBankEntry): boolean =>
    ctx.config.bankFilter.matches(entry.bankName),
  );
}

/**
 * Maps the banks config record into a flat IBankEntry[].
 * @param banks - Banks dictionary from importer config.
 * @returns Frozen IBankEntry array.
 */
function mapEntries(
  banks: Record<string, IBankConfig>,
): readonly IBankEntry[] {
  return Object.entries(banks).map(toEntry);
}

/**
 * Converts a [name, config] tuple into a frozen IBankEntry.
 * @param pair - Tuple from Object.entries(banks).
 * @returns Frozen IBankEntry.
 */
function toEntry(pair: [string, IBankConfig]): IBankEntry {
  return Object.freeze({ bankName: pair[0], bankConfig: pair[1] });
}

/**
 * Runs the pagination loop and propagates failures as Procedure.
 * @param ctx - Pipeline context.
 * @param entries - Bank entries to process.
 * @returns Procedure with the bank-run partition + metrics deltas.
 */
async function runBanks(
  ctx: IPipelineContext, entries: readonly IBankEntry[],
): Promise<Procedure<IRunResult>> {
  const pauseMs = ctx.config.delayBetweenBanks ?? 0;
  const strategy = createSequentialStrategy<IBankEntry, IBankResult>(
    { pauseMs },
  );
  const mutator = createMutator();
  return await iterateBanks({ ctx, entries, strategy, mutator });
}

/**
 * Drives the strategy and assembles the run result.
 * @param opts - Bundled ctx + entries + strategy + mutator.
 * @returns Procedure with the run result.
 */
async function iterateBanks(
  opts: IIterateOpts,
): Promise<Procedure<IRunResult>> {
  const processor = buildProcessor(opts.ctx, opts.mutator);
  const result = await opts.strategy.paginate(
    opts.entries, processor, opts.ctx,
  );
  if (isFail(result)) return result;
  const runResult = buildRunResult(
    opts.mutator, result.data, opts.entries.length,
  );
  return succeed(runResult);
}

/**
 * Creates a closure mutator capturing `metrics` (let) and `quarantine` (const).
 * @returns IRunMutator handle for the per-bank processor.
 */
/**
 * Builds the per-entry processor closure for the strategy.
 * @param ctx - Pipeline context.
 * @param mutator - Run mutator.
 * @returns Async processor returning Procedure&lt;IBankResult&gt; per bank.
 */
function buildProcessor(
  ctx: IPipelineContext, mutator: IRunMutator,
): (entry: IBankEntry) => Promise<Procedure<IBankResult>> {
  return async (
    entry: IBankEntry,
  ): Promise<Procedure<IBankResult>> => {
    const start = Date.now();
    mutator.reduce({ kind: 'start', bankName: entry.bankName });
    const outcome = await processOneBank({ entry, ctx, start });
    if (isFail(outcome)) {
      return recordQuarantine(mutator, entry.bankName, start, outcome);
    }
    return recordSuccess(mutator, outcome, entry.bankName);
  };
}

/**
 * Builds the IRunResult from mutator state + successful results.
 * @param mutator - Run mutator carrying quarantine + metrics deltas.
 * @param successful - Successful per-bank results.
 * @param total - Total banks attempted.
 * @returns Frozen IRunResult.
 */
function buildRunResult(
  mutator: IRunMutator,
  successful: readonly IBankResult[],
  total: number,
): IRunResult {
  const partition: IBankResultsState = Object.freeze({
    successful,
    quarantined: mutator.getQuarantine(),
    totalBanks: total,
  });
  return Object.freeze({ partition, metricsAcc: mutator.getMetrics() });
}

/**
 * Processes a single bank end-to-end.
 * @param opts - Per-bank opts.
 * @returns Procedure&lt;IBankResult&gt; for this bank.
 */
async function processOneBank(
  opts: IBankOpts,
): Promise<Procedure<IBankResult>> {
  opts.ctx.logger.info(`\nProcessing bank: ${opts.entry.bankName}`);
  return await runScrapeMapImport(opts);
}

/**
 * Threads scrape→map→import; short-circuits on the first failure.
 * @param opts - Per-bank opts.
 * @returns Procedure&lt;IBankResult&gt; for this bank.
 */
async function runScrapeMapImport(
  opts: IBankOpts,
): Promise<Procedure<IBankResult>> {
  const scrape = await scrapeStage(opts);
  if (isFail(scrape)) return scrape;
  const canonical = mapStage(opts, scrape.data);
  if (isFail(canonical)) return canonical;
  return await importStage(opts, canonical.data);
}

/**
 * Finalizes the pipeline ctx; fails if every bank was quarantined (INV-4).
 * @param ctx - Pipeline context.
 * @param partition - Bank partition from the iteration loop.
 * @returns Procedure with new context state.
 */
function finalizeContext(
  ctx: IPipelineContext, partition: IBankResultsState,
): Procedure<IPipelineContext> {
  const newCtx = buildNewCtx(ctx, partition);
  if (partition.totalBanks === 0) return succeed(newCtx);
  if (partition.successful.length === 0) {
    return fail('all-banks-failed', { status: 'banks-failed' });
  }
  return succeed(newCtx);
}

/**
 * Builds the new immutable IPipelineContext snapshot.
 * @param ctx - Previous context.
 * @param partition - Bank partition to attach to state.
 * @returns Frozen IPipelineContext with updated state.
 */
function buildNewCtx(
  ctx: IPipelineContext, partition: IBankResultsState,
): IPipelineContext {
  const newState = Object.freeze({
    ...ctx.state,
    banksProcessed: partition.successful.length,
    bankResults: partition,
  });
  return Object.freeze({ ...ctx, state: newState });
}
