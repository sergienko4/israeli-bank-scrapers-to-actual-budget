/**
 * Immutable context that flows through the pipeline.
 * Each step receives the previous step's context and returns a new one.
 */

import type { ILogger } from '../../../Logger/ILogger.js';
import type { IShutdownHandler } from '../../../Resilience/GracefulShutdown.js';
import type { BankScraper } from '../../../Scraper/BankScraper.js';
import type { AccountImporter } from '../../../Services/AccountImporter.js';
import type { IAuditLog } from '../../../Services/AuditLogService.js';
import type { DryRunCollector } from '../../../Services/DryRunCollector.js';
import type { ICategoryResolver } from '../../../Services/ICategoryResolver.js';
import type { MetricsService } from '../../../Services/MetricsService.js';
import type NotificationService from '../../../Services/NotificationService.js';
import type { ReconciliationService } from '../../../Services/ReconciliationService.js';
import type { TransactionService } from '../../../Services/TransactionService.js';
import type { IImporterConfig } from '../../../Types/Index.js';

/** Holds all injected service instances — no direct imports allowed in pipeline steps. */
export interface IServiceContainer {
  readonly transactionService: TransactionService;
  readonly reconciliationService: ReconciliationService;
  readonly metricsService: MetricsService;
  readonly auditLogService: IAuditLog;
  readonly notificationService: NotificationService;
  readonly bankScraper: BankScraper;
  readonly accountImporter: AccountImporter;
  readonly categoryResolver: ICategoryResolver | false;
  readonly dryRunCollector: DryRunCollector;
}

/** Accumulated state that evolves as the pipeline progresses. */
export interface IPipelineState {
  readonly isDryRun: boolean;
  readonly apiInitialized: boolean;
  readonly banksProcessed: number;
  readonly [key: string]: unknown;
}

/** Immutable context threaded through every pipeline step. */
export interface IPipelineContext {
  readonly config: IImporterConfig;
  readonly logger: ILogger;
  readonly shutdownHandler: IShutdownHandler;
  readonly services: IServiceContainer;
  readonly state: IPipelineState;
}
