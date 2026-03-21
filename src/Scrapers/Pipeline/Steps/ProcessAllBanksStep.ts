/**
 * Pipeline step: Process all configured banks sequentially.
 * Uses pagination strategy for sequential bank iteration with shutdown checks.
 */

import type {
  IPipelineContext,
  PipelineStep,
  Procedure,
} from '../Index.js';
import { fail, isFail, succeed } from '../Index.js';
import type { IPaginationStrategy } from '../Strategies/IPaginationStrategy.js';
import createSequentialStrategy from '../Strategies/SequentialPaginationStrategy.js';

/** A bank entry extracted from config for processing. */
interface IBankEntry {
  readonly bankName: string;
  readonly bankConfig: IPipelineContext['config']['banks'][string];
}

/** Import counts returned by processOneBank. */
interface IImportCounts {
  readonly imported: number;
  readonly skipped: number;
}

/**
 * Creates a step that scrapes and imports all configured banks.
 * @returns PipelineStep that processes banks via pagination strategy.
 */
export default function createProcessAllBanksStep(): PipelineStep {
  /**
   * Inner step that processes all banks sequentially.
   * @param ctx - Pipeline context for this step.
   * @returns Procedure with total banks processed.
   */
  return async (
    ctx: IPipelineContext
  ): ReturnType<PipelineStep> => {
    ctx.logger.info('Processing all banks...');
    ctx.services.metricsService.startImport();

    const bankEntries = buildBankEntries(ctx);
    const pauseMs = ctx.config.delayBetweenBanks ?? 0;
    const strategy = createSequentialStrategy<
      IBankEntry,
      IImportCounts
    >({ pauseMs });

    return runStrategy(ctx, strategy, bankEntries);
  };
}

/**
 * Executes the pagination strategy and returns the result.
 * @param ctx - Pipeline context.
 * @param strategy - Sequential pagination strategy.
 * @param bankEntries - List of banks to process.
 * @returns Procedure with banksProcessed count in state.
 */
async function runStrategy(
  ctx: IPipelineContext,
  strategy: IPaginationStrategy<IBankEntry, IImportCounts>,
  bankEntries: readonly IBankEntry[]
): ReturnType<PipelineStep> {
  /**
   * Processes a single bank entry via the strategy.
   * @param entry - Bank entry to process.
   * @returns Procedure with import counts.
   */
  const processor = (
    entry: IBankEntry
  ): Promise<Procedure<IImportCounts>> => {
    return processOneBank(entry, ctx);
  };

  const result = await strategy.paginate(
    bankEntries, processor, ctx
  );
  if (isFail(result)) {
    return fail(result.message, { status: 'banks-failed' });
  }

  return toBanksProcessed(ctx, result.data.length);
}

/**
 * Creates a success result with the banks processed count.
 * @param ctx - Pipeline context.
 * @param count - Number of banks processed.
 * @returns Procedure with updated state.
 */
function toBanksProcessed(
  ctx: IPipelineContext,
  count: number
): Procedure<IPipelineContext> {
  return succeed({
    ...ctx,
    state: { ...ctx.state, banksProcessed: count },
  });
}

/**
 * Builds the list of bank entries from config.
 * @param ctx - Pipeline context with config.
 * @returns Array of bank name and config pairs.
 */
function buildBankEntries(
  ctx: IPipelineContext
): readonly IBankEntry[] {
  const envRecord = process.env;
  const importFilter = envRecord.IMPORT_BANKS;
  const allBanks = Object.entries(ctx.config.banks);
  if (!importFilter) {
    return mapToBankEntries(allBanks);
  }

  return filterAndMap(allBanks, importFilter);
}

/**
 * Maps raw entries to typed IBankEntry objects.
 * @param entries - Array of name-config tuples.
 * @returns Typed IBankEntry array.
 */
function mapToBankEntries(
  entries: [string, IBankEntry['bankConfig']][]
): readonly IBankEntry[] {
  return entries.map(toEntry);
}

/**
 * Converts a single name-config tuple to IBankEntry.
 * @param tuple - A two-element array of bank name and config.
 * @returns Typed IBankEntry object.
 */
function toEntry(
  tuple: [string, IBankEntry['bankConfig']]
): IBankEntry {
  const entry: IBankEntry = {
    bankName: tuple[0],
    bankConfig: tuple[1],
  };
  return entry;
}

/**
 * Filters bank entries by IMPORT_BANKS CSV and maps to IBankEntry.
 * @param allBanks - All bank name-config tuples.
 * @param importFilter - Comma-separated bank name filter.
 * @returns Filtered and typed IBankEntry array.
 */
function filterAndMap(
  allBanks: [string, IBankEntry['bankConfig']][],
  importFilter: string
): readonly IBankEntry[] {
  /**
   * Trims whitespace from a bank name filter token.
   * @param bankToken - Raw bank name token.
   * @returns Trimmed bank name string.
   */
  const trimToken = (bankToken: string): string => {
    return bankToken.trim();
  };
  const filterSet = new Set(
    importFilter.split(',').map(trimToken)
  );
  /**
   * Checks if a bank name is in the filter set.
   * @param entry - Bank name-config tuple.
   * @returns True if the bank passes the filter.
   */
  const matchesFilter = (
    entry: [string, IBankEntry['bankConfig']]
  ): boolean => filterSet.has(entry[0]);

  return allBanks.filter(matchesFilter).map(toEntry);
}

/**
 * Processes a single bank: scrape then import accounts.
 * @param entry - Bank name and config.
 * @param ctx - Pipeline context with services.
 * @returns Procedure with import counts.
 */
async function processOneBank(
  entry: IBankEntry,
  ctx: IPipelineContext
): Promise<Procedure<IImportCounts>> {
  ctx.services.metricsService.startBank(entry.bankName);
  ctx.logger.info(`\nProcessing bank: ${entry.bankName}`);

  return scrapeAndImport(entry, ctx);
}

/**
 * Runs scrape and import pipeline for a single bank.
 * @param entry - Bank name and config.
 * @param ctx - Pipeline context with services.
 * @returns Procedure with import counts or failure.
 */
async function scrapeAndImport(
  entry: IBankEntry,
  ctx: IPipelineContext
): Promise<Procedure<IImportCounts>> {
  const scrapeResult =
    await ctx.services.bankScraper.scrapeBankWithResilience(
      entry.bankName,
      entry.bankConfig
    );
  if (!scrapeResult.success) {
    return handleScrapeFailure(entry, ctx, scrapeResult);
  }

  return importAccounts(entry, ctx, scrapeResult);
}

/**
 * Handles a failed scrape by recording failure and returning error.
 * @param entry - Bank name and config.
 * @param ctx - Pipeline context with services.
 * @param scrapeResult - The failed scraper result.
 * @param scrapeResult.errorMessage - Optional error message from scraper.
 * @returns Failure Procedure with scrape-failed status.
 */
function handleScrapeFailure(
  entry: IBankEntry,
  ctx: IPipelineContext,
  scrapeResult: { errorMessage?: string }
): Procedure<IImportCounts> {
  const errorMsg =
    scrapeResult.errorMessage ?? 'Scrape failed';
  ctx.services.metricsService.recordBankFailure(
    entry.bankName,
    new Error(errorMsg)
  );
  return fail(errorMsg, { status: 'scrape-failed' });
}

/**
 * Imports accounts from a successful scrape and records metrics.
 * @param entry - Bank name and config.
 * @param ctx - Pipeline context with services.
 * @param scrapeResult - The successful scraper result.
 * @returns Procedure with import counts.
 */
async function importAccounts(
  entry: IBankEntry,
  ctx: IPipelineContext,
  scrapeResult: Parameters<
    typeof ctx.services.accountImporter.processAllAccounts
  >[2]
): Promise<Procedure<IImportCounts>> {
  const importResult =
    await ctx.services.accountImporter.processAllAccounts(
      entry.bankName,
      entry.bankConfig,
      scrapeResult
    );
  return recordSuccess(entry, ctx, importResult);
}

/**
 * Records bank success metrics and returns the counts.
 * @param entry - Bank name and config.
 * @param ctx - Pipeline context with metrics service.
 * @param importResult - The raw import result with counts.
 * @param importResult.imported - Number of imported transactions.
 * @param importResult.skipped - Number of skipped transactions.
 * @returns Procedure wrapping the import counts.
 */
function recordSuccess(
  entry: IBankEntry,
  ctx: IPipelineContext,
  importResult: { imported: number; skipped: number }
): Procedure<IImportCounts> {
  ctx.services.metricsService.recordBankSuccess(
    entry.bankName,
    importResult.imported,
    importResult.skipped
  );
  const counts: IImportCounts = {
    imported: importResult.imported,
    skipped: importResult.skipped,
  };
  return succeed(counts);
}
