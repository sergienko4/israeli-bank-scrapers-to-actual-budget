/**
 * Factory that builds the initial IPipelineContext from configuration and services.
 * Wires all dependency injection at the pipeline boundary.
 */

import type { ILogger } from '../../Logger/ILogger.js';
import type { IShutdownHandler } from '../../Resilience/GracefulShutdown.js';
import type { IBankRegistry } from '../../Scraper/BankRegistry.js';
import type { BankScraper } from '../../Scraper/BankScraper.js';
import type { IScrapeResultMapper } from '../../Scraper/Mappers/IScrapeResultMapper.js';
import type { AccountImporter } from '../../Services/AccountImporter.js';
import type { IAuditLog } from '../../Services/AuditLogService.js';
import type { DryRunCollector } from '../../Services/DryRunCollector.js';
import type { ICategoryResolver } from '../../Services/ICategoryResolver.js';
import type { MetricsService } from '../../Services/MetricsService.js';
import type NotificationService from '../../Services/NotificationService.js';
import type { ReconciliationService } from '../../Services/ReconciliationService.js';
import type { TransactionService } from '../../Services/TransactionService.js';
import type { IImporterConfig } from '../../Types/Index.js';
import type { IBankFilter } from '../../Types/Pipeline/Index.js';
import { fromEnv } from './Context/BankFilterPolicy.js';
import type { IPipelineConfig, IPipelineContext } from './Types/PipelineContext.js';

/** All service instances needed to build a pipeline context. */
export interface IContextFactoryInput {
  readonly config: IImporterConfig;
  readonly logger: ILogger;
  readonly shutdownHandler: IShutdownHandler;
  readonly transactionService: TransactionService;
  readonly reconciliationService: ReconciliationService;
  readonly metricsService: MetricsService;
  readonly auditLogService: IAuditLog;
  readonly notificationService: NotificationService;
  readonly bankScraper: BankScraper;
  readonly bankRegistry: IBankRegistry;
  readonly accountImporter: AccountImporter;
  readonly scrapeResultMapper: IScrapeResultMapper;
  readonly categoryResolver: ICategoryResolver | false;
  readonly dryRunCollector: DryRunCollector;
  readonly isDryRun: boolean;
  /**
   * Optional override; when absent, ContextFactory derives the filter from
   * process.env.IMPORT_BANKS via BankFilterPolicy.fromEnv. This is the SOLE
   * site that reads process.env for pipeline filtering (INV-1).
   */
  readonly bankFilter?: IBankFilter;
}

/**
 * Builds the frozen IServiceContainer from factory input.
 * @param input - All service instances.
 * @returns Frozen service container.
 */
function buildServices(input: IContextFactoryInput): IPipelineContext['services'] {
  return Object.freeze({
    transactionService: input.transactionService,
    reconciliationService: input.reconciliationService,
    metricsService: input.metricsService,
    auditLogService: input.auditLogService,
    notificationService: input.notificationService,
    bankScraper: input.bankScraper,
    bankRegistry: input.bankRegistry,
    accountImporter: input.accountImporter,
    scrapeResultMapper: input.scrapeResultMapper,
    categoryResolver: input.categoryResolver,
    dryRunCollector: input.dryRunCollector,
  });
}

/**
 * Builds the frozen pipeline-side config with the resolved bank filter.
 * @param input - Factory input carrying optional bankFilter override.
 * @returns Frozen IPipelineConfig with bankFilter attached.
 */
function buildPipelineConfig(input: IContextFactoryInput): IPipelineConfig {
  const bankFilter = input.bankFilter ?? fromEnv(process.env);
  return Object.freeze({ ...input.config, bankFilter });
}

/**
 * Builds a frozen IPipelineContext from the given services and configuration.
 * @param input - All services and configuration needed for the pipeline.
 * @returns A frozen IPipelineContext ready for pipeline execution.
 */
export default function createInitialContext(
  input: IContextFactoryInput
): IPipelineContext {
  const services = buildServices(input);
  const config = buildPipelineConfig(input);
  const state = Object.freeze({
    isDryRun: input.isDryRun,
    apiInitialized: false,
    banksProcessed: 0,
  });
  return Object.freeze({
    config,
    logger: input.logger,
    shutdownHandler: input.shutdownHandler,
    services,
    state,
  });
}
