/**
 * Pipeline step: process all configured banks with quarantine semantics.
 *
 * Phase-3 invariants:
 *   INV-1  No process.env reads (uses ctx.config.bankFilter).
 *   INV-2  No direct MetricsService side-effects (uses MetricsReducer).
 *   INV-3  Original Error objects propagate end-to-end.
 *   INV-4  All-banks-fail → fail; partial → succeed.
 *   INV-5  state.banksProcessed === state.bankResults.successful.length.
 */

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';

import type {
  IBankConfig, IBankMetricsDelta, IBankQuarantineEntry,
  IBankQuarantineStage, IBankResult, IBankResultsState,
  ICanonicalScrapeResult, IPipelineContext, IProcedureFailure,
  IProcedureSuccess, PipelineStep, Procedure,
} from '../Index.js';
import { fail, fromPromise, isFail, succeed } from '../Index.js';
import type { IMetricsAcc } from '../Reducers/MetricsReducer.js';
import * as MetricsReducer from '../Reducers/MetricsReducer.js';
import type { IPaginationStrategy } from '../Strategies/IPaginationStrategy.js';
import createSequentialStrategy from '../Strategies/SequentialPaginationStrategy.js';

const STAGE_SCRAPE: IBankQuarantineStage = 'scrape';
const STAGE_MAP: IBankQuarantineStage = 'map';
const STAGE_IMPORT: IBankQuarantineStage = 'import';

const STAGE_LOOKUP: Record<string, IBankQuarantineStage> = {
  scrape: STAGE_SCRAPE,
  map: STAGE_MAP,
  import: STAGE_IMPORT,
};

/** Bank entry pulled from config after filter. */
interface IBankEntry {
  readonly bankName: string;
  readonly bankConfig: IBankConfig;
}

/** Shared per-bank opts threaded through scrape→map→import. */
interface IBankOpts {
  readonly entry: IBankEntry;
  readonly ctx: IPipelineContext;
  readonly start: number;
}

/** Imported counts from AccountImporter for one bank. */
interface IImportCounts {
  readonly imported: number;
  readonly skipped: number;
}

/** Closure mutator holding the run's mutable state. */
interface IRunMutator {
  reduce(delta: IBankMetricsDelta): Procedure<{ recorded: true }>;
  addQuarantine(entry: IBankQuarantineEntry): Procedure<{ recorded: true }>;
  getMetrics(): IMetricsAcc;
  getQuarantine(): readonly IBankQuarantineEntry[];
}

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

/** Opts bundle used by recordQuarantine / recordSuccess (params ≤ 3). */
interface IRecordOpts {
  readonly entry: IBankEntry;
  readonly start: number;
  readonly mutator: IRunMutator;
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
function createMutator(): IRunMutator {
  let metrics: IMetricsAcc = MetricsReducer.EMPTY;
  const quarantine: IBankQuarantineEntry[] = [];
  return Object.freeze({
    /**
     * Records a metrics delta into the in-memory accumulator.
     * @param delta - Metrics delta event.
     * @returns Recorded acknowledgement.
     */
    reduce: (delta: IBankMetricsDelta): Procedure<{ recorded: true }> => {
      metrics = MetricsReducer.reduce(metrics, delta);
      return succeed({ recorded: true as const });
    },
    /**
     * Appends a quarantine entry to the run's collection.
     * @param entry - Quarantine entry to append.
     * @returns Recorded acknowledgement.
     */
    addQuarantine: (
      entry: IBankQuarantineEntry,
    ): Procedure<{ recorded: true }> => {
      quarantine.push(entry);
      return succeed({ recorded: true as const });
    },
    /**
     * Returns the current metrics accumulator snapshot.
     * @returns Current IMetricsAcc.
     */
    getMetrics: (): IMetricsAcc => metrics,
    /**
     * Returns the current quarantine array (readonly view).
     * @returns Current quarantine entries.
     */
    getQuarantine: (): readonly IBankQuarantineEntry[] => quarantine,
  });
}

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
    return await processAndRecord(
      { entry, start: Date.now(), mutator }, ctx,
    );
  };
}

/**
 * Records the start delta, processes one bank, and records the outcome.
 * @param opts - Per-bank record opts (entry, start, mutator).
 * @param ctx - Pipeline context.
 * @returns Procedure reflecting the bank outcome.
 */
async function processAndRecord(
  opts: IRecordOpts, ctx: IPipelineContext,
): Promise<Procedure<IBankResult>> {
  opts.mutator.reduce({ kind: 'start', bankName: opts.entry.bankName });
  const outcome = await processOneBank(
    { entry: opts.entry, ctx, start: opts.start },
  );
  if (isFail(outcome)) return recordQuarantine(opts, outcome);
  return recordSuccess(opts.mutator, outcome, opts.entry.bankName);
}

/**
 * Records a successful bank result via a 'success' delta.
 * @param mutator - Run mutator.
 * @param outcome - Successful Procedure carrying the IBankResult.
 * @param bankName - Bank name for the delta payload.
 * @returns The outcome unchanged.
 */
function recordSuccess(
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
 * Records a quarantined bank — pushes entry + emits 'failure' delta.
 * Preserves original Error reference end-to-end (INV-3).
 * @param opts - Per-bank record opts.
 * @param outcome - Failed Procedure carrying status + optional Error.
 * @returns The outcome unchanged (strategy logs + skips).
 */
function recordQuarantine(
  opts: IRecordOpts, outcome: IProcedureFailure,
): Procedure<IBankResult> {
  const stage = stageFromStatus(outcome.status);
  const error = outcome.error ?? new Error(outcome.message);
  const entry: IBankQuarantineEntry = Object.freeze({
    bankName: opts.entry.bankName,
    stage,
    error,
    durationMs: Date.now() - opts.start,
  });
  opts.mutator.addQuarantine(entry);
  opts.mutator.reduce({
    kind: 'failure', bankName: opts.entry.bankName, error,
  });
  return outcome;
}

/**
 * Maps a failure status string to a quarantine stage label.
 * @param status - Status carried on the failed Procedure.
 * @returns Canonical IBankQuarantineStage (defaults to 'import').
 */
function stageFromStatus(status: string): IBankQuarantineStage {
  return STAGE_LOOKUP[status] ?? STAGE_IMPORT;
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
 * Scrapes via resilience-wrapped call and adapts errors to Procedure.
 * @param opts - Per-bank opts.
 * @returns Procedure&lt;IScraperScrapingResult&gt; stamped STAGE_SCRAPE on fail.
 */
async function scrapeStage(
  opts: IBankOpts,
): Promise<Procedure<IScraperScrapingResult>> {
  const scrapePromise = opts.ctx.services.bankScraper
    .scrapeBankWithResilience(opts.entry.bankName, opts.entry.bankConfig);
  const wrapped = await fromPromise(scrapePromise, 'Scrape failed');
  if (isFail(wrapped)) {
    const error = wrapped.error ?? new Error(wrapped.message);
    return fail(wrapped.message, { status: STAGE_SCRAPE, error });
  }
  return checkScrapeSuccess(wrapped.data);
}

/**
 * Promotes provider `.success` boolean into a Procedure outcome.
 * @param result - Legacy IScraperScrapingResult from the scraper.
 * @returns succeed on success, fail STAGE_SCRAPE otherwise.
 */
function checkScrapeSuccess(
  result: IScraperScrapingResult,
): Procedure<IScraperScrapingResult> {
  if (result.success) return succeed(result);
  const message = result.errorMessage ?? 'Scrape failed';
  return fail(message, {
    status: STAGE_SCRAPE, error: new Error(message),
  });
}

/**
 * Canonicalizes the legacy scrape result via the mapper.
 * @param opts - Per-bank opts.
 * @param scrape - Legacy provider result.
 * @returns Procedure&lt;ICanonicalScrapeResult&gt; stamped STAGE_MAP on fail.
 */
function mapStage(
  opts: IBankOpts, scrape: IScraperScrapingResult,
): Procedure<ICanonicalScrapeResult> {
  const result = opts.ctx.services.scrapeResultMapper.legacyToCanonical({
    legacy: scrape,
    bankName: opts.entry.bankName,
    bankConfig: opts.entry.bankConfig,
  });
  if (isFail(result)) {
    const error = result.error ?? new Error(result.message);
    return fail(result.message, { status: STAGE_MAP, error });
  }
  return result;
}

/**
 * Imports canonicalized data via AccountImporter and builds the IBankResult.
 * @param opts - Per-bank opts.
 * @param canonical - Canonical scrape result from mapStage.
 * @returns Procedure&lt;IBankResult&gt; stamped STAGE_IMPORT on fail.
 */
async function importStage(
  opts: IBankOpts, canonical: ICanonicalScrapeResult,
): Promise<Procedure<IBankResult>> {
  const importPromise = opts.ctx.services.accountImporter
    .processAllAccounts(opts.entry.bankName, opts.entry.bankConfig, canonical);
  const imported = await fromPromise(importPromise, 'Import failed');
  if (isFail(imported)) {
    const error = imported.error ?? new Error(imported.message);
    return fail(imported.message, { status: STAGE_IMPORT, error });
  }
  const bankResult = buildBankResult(opts, imported.data);
  return succeed(bankResult);
}

/**
 * Builds the IBankResult for a successfully imported bank.
 * @param opts - Per-bank opts.
 * @param counts - Imported and skipped counts.
 * @returns Frozen IBankResult.
 */
function buildBankResult(
  opts: IBankOpts, counts: IImportCounts,
): IBankResult {
  return Object.freeze({
    bankName: opts.entry.bankName,
    imported: counts.imported,
    skipped: counts.skipped,
    durationMs: Date.now() - opts.start,
  });
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
