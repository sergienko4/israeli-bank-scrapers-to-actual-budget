/**
 * Type definitions for the Israeli Bank Importer.
 *
 * Facade barrel: re-exports every domain type group so existing consumers
 * keep importing from `Types/Index.js`. Domain types live in sibling files
 * (Actual, Bank, Notifications, Logging, Categorization, Telegram, Importer,
 * Import) to keep each concern independently maintainable.
 */

// Result Pattern
export type { IProcedureFailure, IProcedureSuccess, Procedure } from './Procedure.js';
export { fail, fromPromise, isFail, isSuccess, succeed } from './ProcedureHelpers.js';

// Canonical scraping types (Phase-2 contract — see ./Scraping/Index.ts)
export type {
  ICanonicalAccount,
  ICanonicalScrapeMetadata,
  ICanonicalScrapeResult,
  IRawScrape,
  IScrapeStrategyKind,
  ISignPolicy,
} from './Scraping/Index.js';

// Pipeline-specific types (Phase-3 quarantine — see ./Pipeline/Index.ts)
export type {
  IBankFilter,
  IBankMetricsDelta,
  IBankQuarantineEntry,
  IBankQuarantineStage,
  IBankResult,
  IBankResultsState,
} from './Pipeline/Index.js';

// Actual Budget server config + account shapes (see ./Actual.ts)
export type { IActualAccount, IActualConfig } from './Actual.js';

// Bank target, per-bank config, transaction shapes (see ./Bank.ts)
export type {
  IBankConfig,
  IBankTarget,
  IBankTransaction,
  ITransactionRecord,
} from './Bank.js';

// Notification channels + spending-watch rules (see ./Notifications.ts)
export type {
  INotificationConfig,
  ISpendingWatchRule,
  ITelegramConfig,
  IWebhookConfig,
  MessageFormat,
  ShowTransactions,
  WebhookFormat,
} from './Notifications.js';

// Log output config (see ./Logging.ts)
export type { ILogConfig, LogFormat } from './Logging.js';

// Categorization + payee translation (see ./Categorization.ts)
export type {
  CategorizationMode,
  ICategorizationConfig,
  IResolvedCategory,
  ITranslationRule,
} from './Categorization.js';

// Root importer config + proxy + resilience (see ./Importer.ts)
export type { IImporterConfig, IProxyConfig, IResilienceConfig } from './Importer.js';
export { DEFAULT_RESILIENCE_CONFIG } from './Importer.js';

// Config web-portal settings (see ./Portal.ts)
export type { IPortalConfig, IPortalGoogleConfig, PortalAuthMode } from './Portal.js';

// Telegram Bot API wire types + receipt (see ./Telegram.ts)
export type {
  IReceiptData,
  ITelegramApiResponse,
  ITelegramCallbackQuery,
  ITelegramMessageData,
  ITelegramPhotoSize,
  ITelegramUpdate,
} from './Telegram.js';

// Import queue / mediator types (see ./Import.ts)
export type {
  IBatchResult,
  IImportJob,
  IImportJobResult,
  IImportRequestOptions,
  ImportSource,
  IQueueCallbacks,
} from './Import.js';
