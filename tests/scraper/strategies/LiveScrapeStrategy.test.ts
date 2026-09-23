/**
 * LiveScrapeStrategy tests — covers retry strategy selection, OTP retry,
 * session clearing, and OTP-retriever setup previously embedded in
 * BankScraper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';

import { LiveScrapeStrategy } from '../../../src/Scraper/Strategies/LiveScrapeStrategy.js';
import buildCredentials from '../../../src/Scraper/CredentialsBuilder.js';
import type { IBankScrapeStrategyOpts } from '../../../src/Scraper/Strategies/IBankScrapeStrategy.js';
import type { IRetryStrategy } from '../../../src/Resilience/RetryStrategy.js';
import type { ITimeoutWrapper } from '../../../src/Resilience/TimeoutWrapper.js';
import type { ITwoFactorPrompter } from '../../../src/Services/ITwoFactorPrompter.js';
import { fakeBankConfig, fakeBankTokenStore, fakeImporterConfig } from '../../helpers/factories.js';
import { TEST_CREDENTIAL_SHORT } from '../../helpers/testCredentials.js';

vi.mock('node:fs');

const mockScraper = { scrape: vi.fn() };
vi.mock('@sergienko4/israeli-bank-scrapers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sergienko4/israeli-bank-scrapers')>();
  return { ...actual, createScraper: vi.fn(() => mockScraper) };
});

vi.mock('../../../src/Scraper/ScraperOptionsBuilder.js', () => ({
  buildChromeArgs: vi.fn(() => []),
  getChromeDataDir: vi.fn(() => '/mock/chrome'),
}));

vi.mock('../../../src/Scraper/CredentialsBuilder.js', () => ({
  default: vi.fn(() => ({ username: 'u', password: TEST_CREDENTIAL_SHORT })),
}));

const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

type RetryExecuteMock = IRetryStrategy['execute'] & ReturnType<typeof vi.fn>;
type TimeoutWrapMock = ITimeoutWrapper['wrap'] & ReturnType<typeof vi.fn>;

const retryStrategy = {
  execute: vi.fn(async (fn: () => Promise<unknown>, operationName: string) => {
    void operationName;
    return await fn();
  }) as unknown as RetryExecuteMock,
} satisfies IRetryStrategy;
const noRetryStrategy = {
  execute: vi.fn(async (fn: () => Promise<unknown>, operationName: string) => {
    void operationName;
    return await fn();
  }) as unknown as RetryExecuteMock,
} satisfies IRetryStrategy;
const timeoutWrapper = {
  wrap: vi.fn(async (p: Promise<unknown>, timeoutMs: number, operationName: string) => {
    void timeoutMs;
    void operationName;
    return await p;
  }) as unknown as TimeoutWrapMock,
} satisfies ITimeoutWrapper;
const notificationService = {
  sendMessage: vi.fn(), sendSummary: vi.fn(), sendError: vi.fn(),
};

/**
 * Constructs a default LiveScrapeStrategy with shared mock collaborators.
 * @returns LiveScrapeStrategy ready for invocation.
 */
function makeStrategy(): LiveScrapeStrategy {
  return new LiveScrapeStrategy({
    config: fakeImporterConfig(),
    retryStrategy, noRetryStrategy, timeoutWrapper,
    twoFactorPrompter: null,
    notificationService: notificationService as never,
    bankTokens: fakeBankTokenStore(),
  });
}

/**
 * Builds a minimal IBankScrapeStrategyOpts for LiveScrapeStrategy tests.
 * @param overrides - Optional bank-config overrides for the scrape.
 * @returns Opts object suitable for strategy.scrape().
 */
function makeOpts(overrides: Record<string, unknown> = {}): IBankScrapeStrategyOpts {
  return {
    bankId: 'discount', companyType: 'discount' as never,
    bankConfig: fakeBankConfig({ daysBack: 7, ...overrides }),
    startDate: new Date(), logger,
  };
}

/**
 * Reproduces the INIT failure text the provider emits for a landing status.
 *
 * Copied verbatim from the provider's `landingFailureMessage` so this suite
 * fails loudly if the wording the classifier matches on ever drifts.
 * @param status - HTTP status the bank edge served for the landing document.
 * @returns The provider's INIT failure message for that status.
 */
function landingFailure(status: number): string {
  return (
    `INIT ACTION: bank edge served HTTP ${String(status)} for the landing ` +
    `document (https://www.example-bank.co.il/); no later phase can recover from it`
  );
}

/**
 * Emulates the real retry policy, which re-invokes a callback that throws.
 *
 * The shared `retryStrategy` mock runs its callback exactly once, so it cannot
 * show whether a failure was retried. This replacement spends a real attempt
 * budget, making the retry decision observable through the provider call count.
 * @param maxAttempts - Attempt budget mirroring the configured retry count.
 * @returns An execute implementation that retries while the callback throws.
 */
function retryingExecute(maxAttempts: number) {
  return async (fn: () => Promise<unknown>, operationName: string): Promise<unknown> => {
    void operationName;
    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await fn();
      } catch (error: unknown) {
        lastError = error;
      }
    }
    throw lastError;
  };
}

describe('LiveScrapeStrategy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    retryStrategy.execute.mockImplementation(
      async (fn: () => Promise<unknown>, operationName: string) => {
        void operationName;
        return await fn();
      });
    noRetryStrategy.execute.mockImplementation(
      async (fn: () => Promise<unknown>, operationName: string) => {
        void operationName;
        return await fn();
      });
    timeoutWrapper.wrap.mockImplementation(
      async (p: Promise<unknown>, timeoutMs: number, operationName: string) => {
        void timeoutMs;
        void operationName;
        return await p;
      });
  });

  it('delegates to retryStrategy.execute for a normal scrape', async () => {
    mockScraper.scrape.mockResolvedValue({ success: true, accounts: [] });
    const result = await makeStrategy().scrape(makeOpts());
    expect(retryStrategy.execute).toHaveBeenCalled();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.raw.success).toBe(true);
  });

  it('uses noRetryStrategy for twoFactorAuth banks', async () => {
    mockScraper.scrape.mockResolvedValue({ success: true, accounts: [] });
    await makeStrategy().scrape(makeOpts({ twoFactorAuth: true }));
    expect(noRetryStrategy.execute).toHaveBeenCalled();
    expect(retryStrategy.execute).not.toHaveBeenCalled();
  });

  it('retries once on INVALID_OTP and reports attemptCount=2', async () => {
    mockScraper.scrape
      .mockResolvedValueOnce({ success: false, errorType: 'INVALID_OTP', accounts: [] })
      .mockResolvedValueOnce({ success: true, accounts: [] });
    const result = await makeStrategy().scrape(makeOpts());
    expect(notificationService.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('rejected'));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.attemptCount).toBe(2);
  });

  /**
   * API-direct banks cap cold SMS logins at one per scrape (provider 8.7.3).
   * A second scrape would open a fresh budget and mint a replacement token,
   * so the retry is refused here and the operator is told to start a new run.
   */
  describe('INVALID_OTP on API-direct banks', () => {
    it.each(['oneZero', 'pepper', 'payBox'])(
      'does not spend a second cold login for %s',
      async (companyType) => {
        mockScraper.scrape.mockResolvedValue({
          success: false, errorType: 'INVALID_OTP', accounts: [],
        });

        const result = await makeStrategy().scrape({
          ...makeOpts(), bankId: companyType, companyType: companyType as never,
        });

        expect(mockScraper.scrape).toHaveBeenCalledTimes(1);
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.attemptCount).toBe(1);
      },
    );

    it('tells the operator a new scrape is needed rather than promising a new code', async () => {
      mockScraper.scrape.mockResolvedValue({
        success: false, errorType: 'INVALID_OTP', accounts: [],
      });

      await makeStrategy().scrape({
        ...makeOpts(), bankId: 'oneZero', companyType: 'oneZero' as never,
      });

      expect(notificationService.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('start a new scrape'),
      );
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('new scrape'));
    });

    it('never promises the operator a replacement code it will not request', async () => {
      mockScraper.scrape.mockResolvedValue({
        success: false, errorType: 'INVALID_OTP', accounts: [],
      });

      await makeStrategy().scrape({
        ...makeOpts(), bankId: 'oneZero', companyType: 'oneZero' as never,
      });

      const [[sent]] = vi.mocked(notificationService.sendMessage).mock.calls;
      expect(sent).not.toContain('A new code will be requested');
    });

    it('carries the refusal reason on the failure the operator is shown', async () => {
      mockScraper.scrape.mockResolvedValue({
        success: false, errorType: 'INVALID_OTP', accounts: [],
      });

      const result = await makeStrategy().scrape({
        ...makeOpts(), bankId: 'oneZero', companyType: 'oneZero' as never,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.raw.errorMessage).toContain('one SMS login per scrape');
      }
    });

    it('still retries a browser bank, which has no cold-login budget', async () => {
      mockScraper.scrape
        .mockResolvedValueOnce({ success: false, errorType: 'INVALID_OTP', accounts: [] })
        .mockResolvedValueOnce({ success: true, accounts: [] });

      const result = await makeStrategy().scrape(makeOpts());

      expect(mockScraper.scrape).toHaveBeenCalledTimes(2);
      if (result.success) expect(result.data.attemptCount).toBe(2);
    });
  });

  it('clears bank session when clearSession is set', async () => {
    mockScraper.scrape.mockResolvedValue({ success: true, accounts: [] });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.rmSync).mockReturnValue(undefined);
    await makeStrategy().scrape(makeOpts({ clearSession: true }));
    expect(fs.rmSync).toHaveBeenCalled();
  });

  it('reports attemptCount=1 when the first attempt succeeds', async () => {
    mockScraper.scrape.mockResolvedValue({ success: true, accounts: [] });
    const result = await makeStrategy().scrape(makeOpts());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.attemptCount).toBe(1);
  });

  it('fails with status="unknown-bank" when companyType is undefined', async () => {
    const opts: IBankScrapeStrategyOpts = {
      bankId: 'mysteryBank',
      bankConfig: fakeBankConfig({ daysBack: 7 }),
      startDate: new Date(), logger,
    };
    const result = await makeStrategy().scrape(opts);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.message).toContain('Unknown bank: mysteryBank');
    expect(result.status).toBe('unknown-bank');
    expect(retryStrategy.execute).not.toHaveBeenCalled();
    expect(noRetryStrategy.execute).not.toHaveBeenCalled();
  });

  it('attaches OTP retriever even when otpLongTermToken is set (cold-fallback)', async () => {    mockScraper.scrape.mockResolvedValue({ success: true, accounts: [] });
    const createOtpRetriever = vi.fn(() => async () => '123456');
    const twoFactorPrompter: ITwoFactorPrompter = { createOtpRetriever };
    const strategy = new LiveScrapeStrategy({
      config: fakeImporterConfig(),
      retryStrategy, noRetryStrategy, timeoutWrapper,
      twoFactorPrompter,
      notificationService: notificationService as never,
      bankTokens: fakeBankTokenStore(),
    });
    await strategy.scrape(makeOpts({
      twoFactorAuth: true, otpLongTermToken: 'placeholder-not-a-jwt',
    }));
    expect(createOtpRetriever).toHaveBeenCalledWith('discount', undefined);
  });

  describe('terminal landing failures', () => {
    beforeEach(() => {
      retryStrategy.execute.mockImplementation(retryingExecute(3) as never);
    });

    it.each([404, 410])(
      'spends one attempt when the bank edge reports the landing gone (HTTP %i)',
      async (status) => {
        mockScraper.scrape.mockResolvedValue({
          success: false, errorType: 'GENERIC', errorMessage: landingFailure(status),
          accounts: [],
        });
        const result = await makeStrategy().scrape(makeOpts());
        expect(mockScraper.scrape).toHaveBeenCalledTimes(1);
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.raw.success).toBe(false);
      },
    );

    it('still spends the full budget on a transient GENERIC failure', async () => {
      mockScraper.scrape.mockResolvedValue({
        success: false, errorType: 'GENERIC', errorMessage: 'socket hang up', accounts: [],
      });
      const result = await makeStrategy().scrape(makeOpts());
      expect(mockScraper.scrape).toHaveBeenCalledTimes(3);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.raw.success).toBe(false);
    });

    it.each([403, 429, 503])(
      'still spends the full budget on a challenge-capable landing status (HTTP %i)',
      async (status) => {
        mockScraper.scrape.mockResolvedValue({
          success: false, errorType: 'GENERIC', errorMessage: landingFailure(status),
          accounts: [],
        });
        await makeStrategy().scrape(makeOpts());
        expect(mockScraper.scrape).toHaveBeenCalledTimes(3);
      },
    );
  });

  /**
   * Backstop for the completion callback. The provider swallows callback
   * errors and only fires the hook on API-direct banks, so a result that
   * carries the token while the hook stayed silent must still be persisted —
   * otherwise the run pays for an SMS it already earned the right to skip.
   */
  describe('durable token persistence', () => {
    /**
     * Builds a strategy whose token store records what the scrape persisted.
     * @param bankTokens - Store collaborator under observation.
     * @returns LiveScrapeStrategy wired to that store.
     */
    function strategyWithStore(bankTokens: ReturnType<typeof fakeBankTokenStore>) {
      return new LiveScrapeStrategy({
        config: fakeImporterConfig(),
        retryStrategy, noRetryStrategy, timeoutWrapper,
        twoFactorPrompter: null,
        notificationService: notificationService as never,
        bankTokens,
      });
    }

    it('stores the long-term token a successful oneZero result carried', async () => {
      const bankTokens = fakeBankTokenStore();
      mockScraper.scrape.mockResolvedValue({
        success: true, accounts: [], persistentOtpToken: 'ten-year-id-token',
      });

      await strategyWithStore(bankTokens).scrape({
        ...makeOpts(), bankId: 'oneZero', companyType: 'oneZero' as never,
      });

      expect(bankTokens.tokens.get('oneZero')).toBe('ten-year-id-token');
    });

    it('stores a token a failed scrape had already minted, replacing the revoked one', async () => {
      const bankTokens = fakeBankTokenStore({ oneZero: 'existing-token' });
      mockScraper.scrape.mockResolvedValue({
        success: false, errorType: 'GENERIC', errorMessage: 'nope', accounts: [],
        persistentOtpToken: 'half-minted-token',
      });

      await strategyWithStore(bankTokens).scrape({
        ...makeOpts(), bankId: 'oneZero', companyType: 'oneZero' as never,
      });

      expect(bankTokens.tokens.get('oneZero')).toBe('half-minted-token');
    });

    it('ignores a token reported by a bank that cannot warm-start', async () => {
      const bankTokens = fakeBankTokenStore();
      mockScraper.scrape.mockResolvedValue({
        success: true, accounts: [], persistentOtpToken: 'unexpected-token',
      });

      await strategyWithStore(bankTokens).scrape(makeOpts());

      expect(bankTokens.tokens.size).toBe(0);
    });

    it('feeds a stored token back into the credentials on the next run', async () => {
      const bankTokens = fakeBankTokenStore({ oneZero: 'ten-year-id-token' });
      mockScraper.scrape.mockResolvedValue({ success: true, accounts: [] });

      await strategyWithStore(bankTokens).scrape({
        ...makeOpts({ otpLongTermToken: 'stale-config-seed' }),
        bankId: 'oneZero', companyType: 'oneZero' as never,
      });

      const [bankConfig] = vi.mocked(buildCredentials).mock.calls[0] ?? [];
      expect(bankConfig?.otpLongTermToken).toBe('ten-year-id-token');
    });
  });
});
