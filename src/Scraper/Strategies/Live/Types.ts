/**
 * Live strategy type contracts shared by the extracted helper modules.
 * @internal
 */

import type {
  CompanyTypes,
  createScraper,
  ScraperCredentials,
} from '@sergienko4/israeli-bank-scrapers';

import type { ILogger } from '../../../Logger/ILogger.js';
import type { IRetryStrategy } from '../../../Resilience/RetryStrategy.js';
import type { ITimeoutWrapper } from '../../../Resilience/TimeoutWrapper.js';
import type { ITwoFactorPrompter } from '../../../Services/ITwoFactorPrompter.js';
import type NotificationService from '../../../Services/NotificationService.js';
import type { IBankConfig, IImporterConfig } from '../../../Types/Index.js';
import type { IBankScrapeStrategyOpts } from '../IBankScrapeStrategy.js';

/** Dependencies captured once by the public LiveScrapeStrategy facade. */
export interface ILiveScrapeDependencies {
  readonly config: IImporterConfig;
  readonly retryStrategy: IRetryStrategy;
  readonly noRetryStrategy: IRetryStrategy;
  readonly timeoutWrapper: ITimeoutWrapper;
  readonly twoFactorPrompter: ITwoFactorPrompter | null;
  readonly notificationService: NotificationService;
}

/** Internal opts after companyType is proven present. */
export type IResolvedLiveOpts = Omit<IBankScrapeStrategyOpts, 'companyType'> & {
  readonly companyType: CompanyTypes;
};

/** Async OTP-code supplier injected into provider credentials/options. */
export type IOtpRetriever = () => Promise<string>;

/** Optional OTP retriever carried through provider setup. */
export type IOptionalOtpRetriever = IOtpRetriever | undefined;

/** Parameter bundle for constructing a Telegram-backed OTP retriever. */
export interface IOtpRetrieverParams {
  readonly bankId: string;
  readonly bankConfig: IBankConfig;
  readonly prompter: ITwoFactorPrompter | null;
  readonly logger: ILogger;
}

/** Provider scraper instance produced by createScraper(). */
export type ILiveProviderScraper = ReturnType<typeof createScraper>;

/** Configured provider objects required to execute one attempt. */
export interface IInitializedLiveScrape {
  readonly scraper: ILiveProviderScraper;
  readonly credentials: ScraperCredentials;
}

/** Timeout wrapper input bundle for one provider scrape invocation. */
export interface ITimeoutScrapeParams {
  readonly deps: ILiveScrapeDependencies;
  readonly scraper: ILiveProviderScraper;
  readonly credentials: ScraperCredentials;
  readonly label: string;
}
