/**
 * Israeli Bank Importer for Actual Budget
 * Main entry point — initializes services and runs the import pipeline.
 */

import api from '@actual-app/api';

import { ErrorFormatter } from './Errors/ErrorFormatter.js';
import { bootConfigAndLogger, handleValidateMode } from './Importer/ConfigBootstrap.js';
import { getLogger } from './Logger/Index.js';
import { GracefulShutdownHandler } from './Resilience/GracefulShutdown.js';
import { ExponentialBackoffRetry } from './Resilience/RetryStrategy.js';
import { TimeoutWrapper } from './Resilience/TimeoutWrapper.js';
import { createBankRegistry } from './Scraper/BankRegistry.js';
import { BankScraper, createDateRangePolicy } from './Scraper/BankScraper.js';
import createScrapeResultMapper from './Scraper/Mappers/DefaultScrapeResultMapper.js';
import type { IBankScrapeStrategy } from './Scraper/Strategies/IBankScrapeStrategy.js';
import { LiveScrapeStrategy } from './Scraper/Strategies/LiveScrapeStrategy.js';
import { MockScrapeStrategy } from './Scraper/Strategies/MockScrapeStrategy.js';
import createInitialContext from './Scrapers/Pipeline/ContextFactory.js';
// Pipeline imports
import { ChainBuilder, execute } from './Scrapers/Pipeline/Index.js';
import createEvaluateSpendingWatchStep from './Scrapers/Pipeline/Steps/EvaluateSpendingWatchStep.js';
import createFinalizeImportStep from './Scrapers/Pipeline/Steps/FinalizeImportStep.js';
import createInitializeApiStep from './Scrapers/Pipeline/Steps/InitializeApiStep.js';
import createInitializeCategoryResolverStep from './Scrapers/Pipeline/Steps/InitializeCategoryResolverStep.js';
import createProcessAllBanksStep from './Scrapers/Pipeline/Steps/ProcessAllBanksStep.js';
import { AccountImporter } from './Services/AccountImporter.js';
import { AuditLogService } from './Services/AuditLogService.js';
import { DryRunCollector } from './Services/DryRunCollector.js';
import HistoryCategoryResolver from './Services/HistoryCategoryResolver.js';
import type { ICategoryResolver } from './Services/ICategoryResolver.js';
import type { ITwoFactorPrompter } from './Services/ITwoFactorPrompter.js';
import { MetricsService } from './Services/MetricsService.js';
import TelegramNotifier from './Services/Notifications/TelegramNotifier.js';
import NotificationService from './Services/NotificationService.js';
import { ReconciliationService } from './Services/ReconciliationService.js';
import SpendingWatchService from './Services/SpendingWatchService.js';
import { TransactionService } from './Services/TransactionService.js';
import TranslateCategoryResolver from './Services/TranslateCategoryResolver.js';
import TwoFactorService from './Services/TwoFactorService.js';
import type { CategorizationMode, IImporterConfig, Procedure } from './Types/Index.js';
import { DEFAULT_RESILIENCE_CONFIG, isFail, succeed } from './Types/Index.js';
import { errorMessage } from './Utils/Index.js';

// --validate mode: validate config and exit before full initialization
await handleValidateMode();

// Load configuration and initialize logger
const CONFIG: IImporterConfig = bootConfigAndLogger();
const LOGGER = getLogger();

// Initialize resilience components
const SHUTDOWN_HANDLER = new GracefulShutdownHandler();
const RETRY_STRATEGY = new ExponentialBackoffRetry({
  maxAttempts: DEFAULT_RESILIENCE_CONFIG.maxRetryAttempts,
  initialBackoffMs: DEFAULT_RESILIENCE_CONFIG.initialBackoffMs,
  /**
   * Returns whether the shutdown handler is active.
   * @returns True once a shutdown signal has been received.
   */
  shouldShutdown: (): boolean => SHUTDOWN_HANDLER.isShuttingDown(),
  /**
   * Returns false for WAF block errors so they are not retried.
   * @param error - The error from the failed attempt.
   * @returns True to retry, false for WAF blocks.
   */
  shouldRetry: (error: Error): boolean => error.name !== 'WafBlockError',
});
const NO_RETRY_STRATEGY = new ExponentialBackoffRetry({
  maxAttempts: 1,
  initialBackoffMs: 0,
  /**
   * Returns whether the shutdown handler is active.
   * @returns True once a shutdown signal has been received.
   */
  shouldShutdown: (): boolean => SHUTDOWN_HANDLER.isShuttingDown(),
});
const TIMEOUT_WRAPPER = new TimeoutWrapper();
const ERROR_FORMATTER = new ErrorFormatter();

// ─── Category resolver (OCP dispatch) ───
const RESOLVER_FACTORIES: Record<
  CategorizationMode,
  (cfg: IImporterConfig) => Procedure<ICategoryResolver | false>
> = {
  /**
   * Returns a success with false — no categorization applied.
   * @returns Procedure with false payload.
   */
  none: (): Procedure<ICategoryResolver | false> => succeed(false as const),
  /**
   * Returns a HistoryCategoryResolver backed by the Actual API.
   * @returns Procedure with a new HistoryCategoryResolver.
   */
  history: (): Procedure<ICategoryResolver | false> => succeed(new HistoryCategoryResolver(api)),
  /**
   * Returns a TranslateCategoryResolver using the configured translation rules.
   * @param cfg - The full IImporterConfig containing translation rules.
   * @returns Procedure with a new TranslateCategoryResolver.
   */
  translate: (cfg: IImporterConfig): Procedure<ICategoryResolver | false> => succeed(
    new TranslateCategoryResolver(cfg.categorization?.translations ?? [])
  ),
};

/**
 * Creates the appropriate ICategoryResolver based on the categorization mode in config.
 * @param cfg - The IImporterConfig containing categorization settings.
 * @returns Procedure with the resolver, or false for mode 'none'.
 */
function createCategoryResolver(cfg: IImporterConfig): Procedure<ICategoryResolver | false> {
  const mode = cfg.categorization?.mode ?? 'none';
  return RESOLVER_FACTORIES[mode](cfg);
}

// Initialize services
const isDryRun = process.env.DRY_RUN === 'true';
const DRY_RUN_COLLECTOR = new DryRunCollector();
const CATEGORY_RESULT = createCategoryResolver(CONFIG);
const hasResolver = CATEGORY_RESULT.success && CATEGORY_RESULT.data !== false;
const CATEGORY_RESOLVER = hasResolver ? CATEGORY_RESULT.data : void 0;
const TRANSACTION_SERVICE = new TransactionService(api, CATEGORY_RESOLVER);
const RECONCILIATION_SERVICE = new ReconciliationService(api);
const METRICS = new MetricsService();
const AUDIT_LOG = new AuditLogService();
const NOTIFICATION_SERVICE = new NotificationService(CONFIG.notifications);
const TELEGRAM_CFG = CONFIG.notifications?.telegram;
const TELEGRAM_NOTIFIER = TELEGRAM_CFG ? new TelegramNotifier(TELEGRAM_CFG) : null;
const TWO_FACTOR_PROMPTER: ITwoFactorPrompter | null =
  TELEGRAM_NOTIFIER ? new TwoFactorService(TELEGRAM_NOTIFIER) : null;

LOGGER.info('🚀 Starting Israeli Bank Importer for Actual Budget\n');
if (isDryRun) LOGGER.info('🔍 DRY RUN MODE — no changes will be made to Actual Budget\n');
if (CONFIG.proxy?.server) LOGGER.info('🌐 Using configured proxy');

// Wire up orchestration — select scrape strategy by env (mock vs live).
const MOCK_DIR = process.env.E2E_MOCK_SCRAPER_DIR;
const MOCK_FILE = process.env.E2E_MOCK_SCRAPER_FILE;
const isMockMode = Boolean(MOCK_DIR || MOCK_FILE);
const SCRAPE_STRATEGY: IBankScrapeStrategy = isMockMode
  ? new MockScrapeStrategy({ mockDir: MOCK_DIR, mockFile: MOCK_FILE, logger: LOGGER })
  : new LiveScrapeStrategy({
      config: CONFIG,
      retryStrategy: RETRY_STRATEGY,
      noRetryStrategy: NO_RETRY_STRATEGY,
      timeoutWrapper: TIMEOUT_WRAPPER,
      twoFactorPrompter: TWO_FACTOR_PROMPTER,
      notificationService: NOTIFICATION_SERVICE,
    });
const SCRAPE_RESULT_MAPPER = createScrapeResultMapper();
const BANK_SCRAPER = new BankScraper({
  registry: createBankRegistry(),
  strategy: SCRAPE_STRATEGY,
  mapper: SCRAPE_RESULT_MAPPER,
  datePolicy: createDateRangePolicy(),
  logger: LOGGER,
});
const ACCOUNT_IMPORTER = new AccountImporter({
  transactionService: TRANSACTION_SERVICE,
  reconciliationService: RECONCILIATION_SERVICE,
  metrics: METRICS,
  isDryRun: isDryRun,
  dryRunCollector: DRY_RUN_COLLECTOR,
  shutdownHandler: SHUTDOWN_HANDLER,
});

// ─── Build Pipeline ───

const WATCH_SERVICE = CONFIG.spendingWatch?.length
  ? new SpendingWatchService(CONFIG.spendingWatch, api) : null;

const PIPELINE_CONTEXT = createInitialContext({
  config: CONFIG,
  logger: LOGGER,
  shutdownHandler: SHUTDOWN_HANDLER,
  transactionService: TRANSACTION_SERVICE,
  reconciliationService: RECONCILIATION_SERVICE,
  metricsService: METRICS,
  auditLogService: AUDIT_LOG,
  notificationService: NOTIFICATION_SERVICE,
  bankScraper: BANK_SCRAPER,
  accountImporter: ACCOUNT_IMPORTER,
  scrapeResultMapper: SCRAPE_RESULT_MAPPER,
  categoryResolver: CATEGORY_RESOLVER ?? false,
  dryRunCollector: DRY_RUN_COLLECTOR,
  isDryRun: isDryRun,
});

/**
 * No-op watch service used when spending watch is not configured.
 * @returns Procedure with the unchanged pipeline context.
 */
const NO_OP_WATCH = {
  /**
   * Returns a no-alerts result — no spending rules configured.
   * @returns Procedure with noAlerts flag.
   */
  evaluate: (): Promise<Procedure<{ noAlerts: true }>> => {
    const noAlertsResult = succeed({ noAlerts: true as const }, 'no-rules');
    return Promise.resolve(noAlertsResult);
  },
};
const EFFECTIVE_WATCH = WATCH_SERVICE ?? NO_OP_WATCH;
const INIT_API_STEP = createInitializeApiStep(api);
const INIT_RESOLVER_STEP = createInitializeCategoryResolverStep();
const PROCESS_BANKS_STEP = createProcessAllBanksStep();
const SPENDING_WATCH_STEP = createEvaluateSpendingWatchStep(EFFECTIVE_WATCH);
const FINALIZE_STEP = createFinalizeImportStep(api);

const PIPELINE = new ChainBuilder()
  .add(INIT_API_STEP, { name: 'init-api', description: 'Connect to Actual Budget' })
  .add(INIT_RESOLVER_STEP, { name: 'init-resolver', description: 'Load category resolver' })
  .add(PROCESS_BANKS_STEP, { name: 'process-banks', description: 'Scrape and import all banks' })
  .add(SPENDING_WATCH_STEP, { name: 'spending-watch', description: 'Check spending rules' })
  .add(FINALIZE_STEP, { name: 'finalize', description: 'Print summary and notify' })
  .build();

/**
 * Best-effort Actual API shutdown that never throws.
 * Catches any error, logs it via the project's `errorMessage()` utility,
 * and returns. Used by both fatal-error and pipeline-failure paths to
 * release the Actual API connection so the Node event loop can exit.
 * @returns Procedure indicating whether shutdown was clean or recovered.
 */
async function safeShutdown(): Promise<Procedure<{ status: string }>> {
  try { await api.shutdown(); }
  catch (error: unknown) {
    LOGGER.error(`Error during API shutdown: ${errorMessage(error)}`);
    return succeed({ status: 'api-shutdown-error' });
  }
  return succeed({ status: 'api-shutdown' });
}

/**
 * Handles an unrecoverable error: logs it, sends a Telegram notification, and exits.
 * @param error - The unknown error caught at the top level.
 * @returns Never — always exits the process with code 1.
 */
async function handleFatalError(error: unknown): Promise<never> {
  const err = error instanceof Error ? error : new Error(String(error));
  const formattedError = ERROR_FORMATTER.format(err);
  LOGGER.error(`\n${formattedError}`);
  if (error instanceof Error) LOGGER.error(`Stack trace: ${error.stack ?? 'N/A'}`);
  await NOTIFICATION_SERVICE.sendError(formattedError);
  await safeShutdown();
  process.exit(1);
}

/**
 * Handles a pipeline-level failure (e.g. all-banks-failed): notifies and exits.
 * Mirrors handleFatalError but for non-throw failures returned by steps so the
 * Docker container shuts down the Actual API and the webhook receives the
 * error event instead of hanging on a live API connection.
 * @param failure - Pipeline failure carrying the user-facing message.
 * @param failure.message - Human-readable pipeline failure message.
 * @returns Never — always exits the process with code 1.
 */
async function handlePipelineFailure(
  failure: { readonly message: string },
): Promise<never> {
  LOGGER.error(`Pipeline failed: ${failure.message}`);
  await NOTIFICATION_SERVICE.sendError(failure.message);
  await safeShutdown();
  process.exit(1);
}

/**
 * Gracefully shuts down the Actual Budget API during process termination.
 * @returns Procedure indicating shutdown result.
 */
async function shutdownApiGracefully(): Promise<Procedure<{ status: string }>> {
  LOGGER.info('🔌 Shutting down Actual Budget API...');
  return await safeShutdown();
}

/**
 * Main entry point: registers shutdown handler, executes the pipeline, handles errors.
 * @returns Procedure indicating overall import result.
 */
async function main(): Promise<Procedure<{ status: string }>> {
  try {
    SHUTDOWN_HANDLER.onShutdown(shutdownApiGracefully);
    const result = await execute(PIPELINE, PIPELINE_CONTEXT);
    if (isFail(result)) return await handlePipelineFailure(result);
    const exitCode = (result.data.state.exitCode as number | undefined) ?? 0;
    process.exit(exitCode);
  } catch (error) {
    return await handleFatalError(error);
  }
}

// Run if executed directly (resolve paths for Docker compatibility)
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CURRENT_PATH = fileURLToPath(import.meta.url);
const CURRENT_FILE = resolve(CURRENT_PATH);
const INVOKED_FILE = resolve(process.argv[1]);
if (CURRENT_FILE === INVOKED_FILE) {
  await main();
}
