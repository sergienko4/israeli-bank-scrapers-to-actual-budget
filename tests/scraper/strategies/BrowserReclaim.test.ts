/**
 * Browser reclamation regression tests for the live scrape strategy.
 *
 * Production incident: `TimeoutWrapper` races the scrape against a deadline,
 * and `Promise.race` abandons the loser rather than cancelling it. The provider
 * kept its Camoufox process alive after every timeout, each retry launched
 * another, and the importer reached ~22 GB RSS until the host wedged. These
 * tests fail against the unfixed strategy and pin the reclamation behaviour.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { LiveScrapeStrategy } from '../../../src/Scraper/Strategies/LiveScrapeStrategy.js';
import type { IBankScrapeStrategyOpts } from '../../../src/Scraper/Strategies/IBankScrapeStrategy.js';
import type { IRetryStrategy } from '../../../src/Resilience/RetryStrategy.js';
import type { ITimeoutWrapper } from '../../../src/Resilience/TimeoutWrapper.js';
import { TimeoutWrapper } from '../../../src/Resilience/TimeoutWrapper.js';
import TimeoutError from '../../../src/Errors/TimeoutError.js';
import { DEFAULT_RESILIENCE_CONFIG } from '../../../src/Types/Index.js';
import type { IProviderBrowser } from '../../../src/Scraper/Strategies/Live/BrowserRegistry.js';
import { fakeBankConfig, fakeImporterConfig } from '../../helpers/factories.js';
import { TEST_CREDENTIAL_SHORT } from '../../helpers/testCredentials.js';

/** Provider options subset carrying the browser lifecycle hook. */
interface ICapturedOptions {
  prepareBrowser?: (browser: IProviderBrowser) => Promise<void>;
}

const mockScraper = { scrape: vi.fn() };
let capturedOptions: ICapturedOptions = {};

vi.mock('@sergienko4/israeli-bank-scrapers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sergienko4/israeli-bank-scrapers')>();
  return {
    ...actual,
    createScraper: vi.fn((options: ICapturedOptions) => {
      capturedOptions = options;
      return mockScraper;
    }),
  };
});

vi.mock('../../../src/Scraper/ScraperOptionsBuilder.js', () => ({
  buildChromeArgs: vi.fn(() => []),
  getChromeDataDir: vi.fn(() => '/mock/chrome'),
}));

vi.mock('../../../src/Scraper/CredentialsBuilder.js', () => ({
  default: vi.fn(() => ({ username: 'u', password: TEST_CREDENTIAL_SHORT })),
}));

const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
const notificationService = {
  sendMessage: vi.fn(), sendSummary: vi.fn(), sendError: vi.fn(),
};

/**
 * Builds a fake browser that reports connected until close() resolves.
 * @returns Fake browser handle usable as a provider browser.
 */
function fakeBrowser() {
  let connected = true;
  return {
    isConnected: vi.fn((): boolean => connected),
    close: vi.fn(async (): Promise<void> => {
      connected = false;
      await Promise.resolve();
    }),
  };
}

/** Fake provider browser recording whether it was closed. */
type IFakeBrowser = ReturnType<typeof fakeBrowser>;

/**
 * Emulates the provider launching a browser during the current scrape.
 * @returns The fake browser handed to the provider lifecycle hook.
 */
async function launchBrowser(): Promise<IFakeBrowser> {
  const browser = fakeBrowser();
  await capturedOptions.prepareBrowser?.(browser);
  return browser;
}

/**
 * Builds a retry strategy that invokes the operation a fixed number of times.
 * @param attempts - Number of times the operation is executed.
 * @returns Retry strategy honouring the requested attempt count.
 */
function retryingStrategy(attempts: number): IRetryStrategy {
  return {
    execute: vi.fn(async (fn: () => Promise<unknown>) => {
      let last: unknown;
      for (let i = 0; i < attempts; i += 1) last = await fn().catch((e: unknown) => e);
      if (last instanceof Error) throw last;
      return last;
    }),
  } as unknown as IRetryStrategy;
}

const passthroughRetry = retryingStrategy(1);

/**
 * Builds a timeout wrapper that abandons the scrape exactly like Promise.race.
 * @returns Timeout wrapper rejecting without awaiting the wrapped promise.
 */
function abandoningTimeout(): ITimeoutWrapper {
  return {
    wrap: vi.fn((promise: Promise<unknown>, timeoutMs: number, name: string) => {
      void promise;
      return Promise.reject(new TimeoutError(name, timeoutMs));
    }),
  } as unknown as ITimeoutWrapper;
}

/**
 * Builds a timeout wrapper that simply awaits the wrapped promise.
 * @returns Timeout wrapper without a deadline.
 */
function passthroughTimeout(): ITimeoutWrapper {
  return {
    wrap: vi.fn(async (promise: Promise<unknown>) => await promise),
  } as unknown as ITimeoutWrapper;
}

/**
 * Constructs a LiveScrapeStrategy with the supplied resilience collaborators.
 * @param timeoutWrapper - Timeout policy applied around the provider call.
 * @param retryStrategy - Retry policy applied around the timed scrape.
 * @returns LiveScrapeStrategy ready for invocation.
 */
function makeStrategy(
  timeoutWrapper: ITimeoutWrapper, retryStrategy: IRetryStrategy = passthroughRetry,
): LiveScrapeStrategy {
  return new LiveScrapeStrategy({
    config: fakeImporterConfig(),
    retryStrategy, noRetryStrategy: retryStrategy, timeoutWrapper,
    twoFactorPrompter: null,
    notificationService: notificationService as never,
  });
}

/**
 * Builds a minimal scrape options object for the discount bank.
 * @returns Opts object suitable for strategy.scrape().
 */
function makeOpts(): IBankScrapeStrategyOpts {
  return {
    bankId: 'discount', companyType: 'discount' as never,
    bankConfig: fakeBankConfig({ daysBack: 7 }),
    startDate: new Date(), logger,
  };
}

describe('live scrape browser reclamation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOptions = {};
  });

  it('closes the browser abandoned by a timed-out scrape', async () => {
    let leaked: IFakeBrowser | undefined;
    mockScraper.scrape.mockImplementation(async () => {
      leaked = await launchBrowser();
      return await new Promise(() => undefined);
    });

    await makeStrategy(abandoningTimeout()).scrape(makeOpts()).catch(() => undefined);

    expect(leaked?.close).toHaveBeenCalledOnce();
    expect(leaked?.isConnected()).toBe(false);
  });

  it('closes the browser of every retry attempt', async () => {
    const leaked: IFakeBrowser[] = [];
    mockScraper.scrape.mockImplementation(async () => {
      leaked.push(await launchBrowser());
      return await new Promise(() => undefined);
    });

    await makeStrategy(abandoningTimeout(), retryingStrategy(3))
      .scrape(makeOpts()).catch(() => undefined);

    expect(leaked).toHaveLength(3);
    expect(leaked.every((b) => b.close.mock.calls.length === 1)).toBe(true);
  });

  it('reports how many browsers each attempt reclaimed', async () => {
    mockScraper.scrape.mockImplementation(async () => {
      await launchBrowser();
      return await new Promise(() => undefined);
    });

    await makeStrategy(abandoningTimeout()).scrape(makeOpts()).catch(() => undefined);

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Reclaimed 1 abandoned browser(s)'));
  });

  it('leaves no browser running after a successful scrape', async () => {
    let launched: IFakeBrowser | undefined;
    mockScraper.scrape.mockImplementation(async () => {
      launched = await launchBrowser();
      return await Promise.resolve({ success: true, accounts: [] });
    });

    const result = await makeStrategy(passthroughTimeout()).scrape(makeOpts());

    expect(result.success).toBe(true);
    expect(launched?.isConnected()).toBe(false);
  });

  it('does not re-close a browser the provider closed itself', async () => {
    let launched: IFakeBrowser | undefined;
    mockScraper.scrape.mockImplementation(async () => {
      launched = await launchBrowser();
      await launched.close();
      launched.close.mockClear();
      return await Promise.resolve({ success: true, accounts: [] });
    });

    await makeStrategy(passthroughTimeout()).scrape(makeOpts());

    expect(launched?.close).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('Reclaimed'));
  });

  it('closes the browsers of both attempts when OTP is rejected', async () => {
    const launched: IFakeBrowser[] = [];
    mockScraper.scrape
      .mockImplementationOnce(async () => {
        launched.push(await launchBrowser());
        return await Promise.resolve({ success: false, errorType: 'INVALID_OTP', accounts: [] });
      })
      .mockImplementationOnce(async () => {
        launched.push(await launchBrowser());
        return await Promise.resolve({ success: true, accounts: [] });
      });

    await makeStrategy(passthroughTimeout()).scrape(makeOpts());

    expect(launched).toHaveLength(2);
    expect(launched.every((b) => b.isConnected() === false)).toBe(true);
  });

  it('still surfaces the scrape result when reclamation fails', async () => {
    mockScraper.scrape.mockImplementation(async () => {
      const browser = await launchBrowser();
      browser.close.mockRejectedValue(new Error('close failed'));
      return await Promise.resolve({ success: true, accounts: [] });
    });

    const result = await makeStrategy(passthroughTimeout()).scrape(makeOpts());

    expect(result.success).toBe(true);
  });

  it('closes a browser the abandoned scrape launches after the attempt ends', async () => {
    mockScraper.scrape.mockImplementation(async () => {
      await launchBrowser();
      return await new Promise(() => undefined);
    });

    await makeStrategy(abandoningTimeout()).scrape(makeOpts()).catch(() => undefined);
    const stray = await launchBrowser();

    expect(stray.close).toHaveBeenCalledOnce();
    expect(stray.isConnected()).toBe(false);
  });
});

describe('live scrape browser reclamation with the real timeout wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOptions = {};
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reclaims the browser stranded by a real Promise.race timeout', async () => {
    let leaked: IFakeBrowser | undefined;
    mockScraper.scrape.mockImplementation(async () => {
      leaked = await launchBrowser();
      return await new Promise(() => undefined);
    });

    const pending = makeStrategy(new TimeoutWrapper())
      .scrape(makeOpts()).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(DEFAULT_RESILIENCE_CONFIG.scrapingTimeoutMs + 1);

    expect(await pending).toBeInstanceOf(TimeoutError);
    expect(leaked?.close).toHaveBeenCalledOnce();
  });
});
