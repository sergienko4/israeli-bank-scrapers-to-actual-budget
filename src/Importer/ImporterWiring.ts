/**
 * Importer top-level wiring.
 *
 * Orchestrator over CoreServicesWiring + PipelineComposition. Exposes
 * a single entry point buildImporter() that returns the minimal handle
 * (IImporterWiring) the orchestrator needs.
 *
 * Third seam of the composition-root decoupling refactor — splits
 * src/Index.ts service+pipeline construction across three siblings
 * (CoreServicesWiring / PipelineComposition / this file) so each
 * stays under the import-dependency, function-length, and complexity
 * caps imposed by the project ESLint config.
 */

import type { ILogger } from '../Logger/ILogger.js';
import { createBankRegistry } from '../Scraper/BankRegistry.js';
import { BankScraper, createDateRangePolicy } from '../Scraper/BankScraper.js';
import createScrapeResultMapper from '../Scraper/Mappers/DefaultScrapeResultMapper.js';
import type { IBankScrapeStrategy } from '../Scraper/Strategies/IBankScrapeStrategy.js';
import type { IContextFactoryInput } from '../Scrapers/Pipeline/ContextFactory.js';
import createInitialContext from '../Scrapers/Pipeline/ContextFactory.js';
import type { IPipelineContext } from '../Scrapers/Pipeline/Types/PipelineContext.js';
import type { INamedStep } from '../Scrapers/Pipeline/Types/PipelineStep.js';
import type { AccountImporter } from '../Services/AccountImporter.js';
import type NotificationService from '../Services/NotificationService.js';
import type { IImporterConfig } from '../Types/Index.js';
import type { ICoreServices } from './CoreServicesWiring.js';
import { buildAccountImporter, buildCoreServices } from './CoreServicesWiring.js';
import { buildPipeline, buildScrapeStrategy, resolveWatchService } from './PipelineComposition.js';
import type { IResilienceComponents } from './ResilienceWiring.js';

/**
 * Minimal handle the orchestrator needs after wiring completes.
 */
export interface IImporterWiring {
  readonly pipeline: readonly INamedStep[];
  readonly pipelineContext: IPipelineContext;
  readonly notificationService: NotificationService;
  readonly isDryRun: boolean;
  readonly hasProxy: boolean;
}

/**
 * Inputs shared by the wiring stages.
 * Bundling keeps every helper under the max-params (3) cap.
 */
interface IWiringInputs {
  readonly config: IImporterConfig;
  readonly resilience: IResilienceComponents;
  readonly services: ICoreServices;
  readonly logger: ILogger;
}

/**
 * Bank-scraper + account-importer + result mapper produced together
 * because they are constructed once and feed createInitialContext.
 */
interface IPipelineDeps {
  readonly bankScraper: BankScraper;
  readonly accountImporter: AccountImporter;
  readonly scrapeResultMapper: ReturnType<typeof createScrapeResultMapper>;
}

/**
 * Constructs the BankScraper from its registry, strategy, mapper, and date policy.
 *
 * @param strategy - The scrape strategy (mock or live) selected by env.
 * @param mapper - The default scrape-result mapper.
 * @param logger - The shared logger.
 * @returns A fully wired BankScraper.
 */
function buildBankScraper(
  strategy: IBankScrapeStrategy,
  mapper: ReturnType<typeof createScrapeResultMapper>,
  logger: ILogger,
): BankScraper {
  return new BankScraper({
    registry: createBankRegistry(),
    strategy,
    mapper,
    datePolicy: createDateRangePolicy(),
    logger,
  });
}

/**
 * Builds the bank scraper + account importer + scrape mapper bundle.
 *
 * @param inputs - The shared wiring inputs.
 * @returns The IPipelineDeps consumed by createInitialContext.
 */
function buildPipelineDeps(inputs: IWiringInputs): IPipelineDeps {
  const strategy = buildScrapeStrategy(inputs);
  const scrapeResultMapper = createScrapeResultMapper();
  const bankScraper = buildBankScraper(strategy, scrapeResultMapper, inputs.logger);
  const accountImporter = buildAccountImporter(inputs.services, inputs.resilience);
  return { bankScraper, accountImporter, scrapeResultMapper };
}

/**
 * The services-derived subset of IContextFactoryInput, isolated as a
 * type alias to keep buildServicesSpec under the function-length cap.
 */
type IServicesSpec = Pick<
  IContextFactoryInput,
  | 'transactionService'
  | 'reconciliationService'
  | 'metricsService'
  | 'auditLogService'
  | 'notificationService'
  | 'categoryResolver'
  | 'dryRunCollector'
  | 'isDryRun'
>;

/**
 * Builds the services-only fields of the context spec.
 *
 * @param services - The core services bundle.
 * @returns The 8 service-derived fields of IContextFactoryInput.
 */
function buildServicesSpec(services: ICoreServices): IServicesSpec {
  return {
    transactionService: services.transactionService,
    reconciliationService: services.reconciliationService,
    metricsService: services.metrics,
    auditLogService: services.auditLog,
    notificationService: services.notificationService,
    categoryResolver: services.categoryResolver ?? false,
    dryRunCollector: services.dryRunCollector,
    isDryRun: services.isDryRun,
  };
}

/**
 * Builds the spec object passed to createInitialContext.
 *
 * @param inputs - The shared wiring inputs.
 * @param deps - The bank scraper + account importer + scrape mapper bundle.
 * @returns The full IContextFactoryInput consumed by createInitialContext.
 */
function buildContextSpec(
  inputs: IWiringInputs,
  deps: IPipelineDeps,
): IContextFactoryInput {
  const { config, resilience, services, logger } = inputs;
  return {
    config,
    logger,
    shutdownHandler: resilience.shutdownHandler,
    ...buildServicesSpec(services),
    ...deps,
  };
}

/**
 * Assembles the IPipelineContext from the fully-built services + bank scraper.
 *
 * @param inputs - The shared wiring inputs.
 * @returns The composed IPipelineContext consumed by execute().
 */
function assembleImporterContext(inputs: IWiringInputs): IPipelineContext {
  const deps = buildPipelineDeps(inputs);
  const spec = buildContextSpec(inputs, deps);
  return createInitialContext(spec);
}

/**
 * Top-level wiring entry: constructs services, scraper, pipeline, and context.
 *
 * @param config - The fully-loaded IImporterConfig.
 * @param resilience - The shared resilience primitives.
 * @param logger - The shared logger.
 * @returns The IImporterWiring handle consumed by the orchestrator.
 */
export function buildImporter(
  config: IImporterConfig,
  resilience: IResilienceComponents,
  logger: ILogger,
): IImporterWiring {
  const services = buildCoreServices(config);
  const inputs: IWiringInputs = { config, resilience, services, logger };
  const pipelineContext = assembleImporterContext(inputs);
  const watchService = resolveWatchService(config);
  return {
    pipeline: buildPipeline(watchService),
    pipelineContext,
    notificationService: services.notificationService,
    isDryRun: services.isDryRun,
    hasProxy: Boolean(config.proxy?.server),
  };
}
