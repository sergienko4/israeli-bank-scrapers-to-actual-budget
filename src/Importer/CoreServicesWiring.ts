/**
 * Importer core-services wiring.
 *
 * Sibling of ImporterWiring.ts — owns construction of the service bundle
 * the pipeline + scrape strategies depend on. Kept in its own file so
 * ImporterWiring.ts stays under the import-dependency cap and so the
 * service-construction logic can be unit-tested in isolation.
 *
 * Exposes:
 *   - ICoreServices — readonly bundle passed to ImporterWiring
 *   - buildCoreServices(config) — single entry point
 */

import api from '@actual-app/api';

import { AccountImporter } from '../Services/AccountImporter.js';
import { AuditLogService } from '../Services/AuditLogService.js';
import { DryRunCollector } from '../Services/DryRunCollector.js';
import HistoryCategoryResolver from '../Services/HistoryCategoryResolver.js';
import type { ICategoryResolver } from '../Services/ICategoryResolver.js';
import type { ITwoFactorPrompter } from '../Services/ITwoFactorPrompter.js';
import { MetricsService } from '../Services/MetricsService.js';
import TelegramNotifier from '../Services/Notifications/TelegramNotifier.js';
import NotificationService from '../Services/NotificationService.js';
import { ReconciliationService } from '../Services/ReconciliationService.js';
import { TransactionService } from '../Services/TransactionService.js';
import TranslateCategoryResolver from '../Services/TranslateCategoryResolver.js';
import TwoFactorService from '../Services/TwoFactorService.js';
import type { CategorizationMode, IImporterConfig, Procedure } from '../Types/Index.js';
import { succeed } from '../Types/Index.js';
import type { IResilienceComponents } from './ResilienceWiring.js';

/**
 * Bundle of core services constructed once per importer run.
 */
export interface ICoreServices {
  readonly isDryRun: boolean;
  readonly dryRunCollector: DryRunCollector;
  readonly categoryResolver: ICategoryResolver | undefined;
  readonly transactionService: TransactionService;
  readonly reconciliationService: ReconciliationService;
  readonly metrics: MetricsService;
  readonly auditLog: AuditLogService;
  readonly notificationService: NotificationService;
  readonly twoFactorPrompter: ITwoFactorPrompter | null;
}

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
 * Resolves the ICategoryResolver dispatched by the categorization mode.
 *
 * @param cfg - The IImporterConfig containing categorization settings.
 * @returns Procedure with the resolver, or false for mode 'none'.
 */
function resolveCategoryResolver(cfg: IImporterConfig): Procedure<ICategoryResolver | false> {
  const mode = cfg.categorization?.mode ?? 'none';
  return RESOLVER_FACTORIES[mode](cfg);
}

/**
 * Builds the core service bundle the pipeline and scrape strategies depend on.
 *
 * @param config - The IImporterConfig used to construct each service.
 * @returns The ICoreServices bundle.
 */
export function buildCoreServices(config: IImporterConfig): ICoreServices {
  const categoryResult = resolveCategoryResolver(config);
  const hasResolver = categoryResult.success && categoryResult.data !== false;
  const categoryResolver = hasResolver ? categoryResult.data : void 0;
  const telegramCfg = config.notifications?.telegram;
  const telegramNotifier = telegramCfg ? new TelegramNotifier(telegramCfg) : null;
  return {
    isDryRun: process.env.DRY_RUN === 'true',
    dryRunCollector: new DryRunCollector(),
    categoryResolver,
    transactionService: new TransactionService(api, categoryResolver),
    reconciliationService: new ReconciliationService(api),
    metrics: new MetricsService(),
    auditLog: new AuditLogService(),
    notificationService: new NotificationService(config.notifications),
    twoFactorPrompter: telegramNotifier ? new TwoFactorService(telegramNotifier) : null,
  };
}

/**
 * Builds the AccountImporter from the core services + shared resilience.
 *
 * @param services - The ICoreServices bundle.
 * @param resilience - The shared IResilienceComponents (for shutdownHandler).
 * @returns A fully wired AccountImporter.
 */
export function buildAccountImporter(
  services: ICoreServices,
  resilience: IResilienceComponents,
): AccountImporter {
  return new AccountImporter({
    transactionService: services.transactionService,
    reconciliationService: services.reconciliationService,
    metrics: services.metrics,
    isDryRun: services.isDryRun,
    dryRunCollector: services.dryRunCollector,
    shutdownHandler: resilience.shutdownHandler,
  });
}
