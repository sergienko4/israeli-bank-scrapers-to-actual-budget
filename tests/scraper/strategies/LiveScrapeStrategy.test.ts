/**
 * LiveScrapeStrategy tests — covers retry strategy selection, OTP retry,
 * session clearing, and OTP-retriever setup previously embedded in
 * BankScraper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';

import { LiveScrapeStrategy } from '../../../src/Scraper/Strategies/LiveScrapeStrategy.js';
import type { IBankScrapeStrategyOpts } from '../../../src/Scraper/Strategies/IBankScrapeStrategy.js';
import { fakeBankConfig, fakeImporterConfig } from '../../helpers/factories.js';
import { TEST_CREDENTIAL_SHORT } from '../../helpers/testCredentials.js';

vi.mock('node:fs');

const mockScraper = { scrape: vi.fn() };
vi.mock('@sergienko4/israeli-bank-scrapers', () => ({
  createScraper: vi.fn(() => mockScraper),
  CompanyTypes: { Discount: 'discount' },
}));

vi.mock('../../../src/Scraper/ScraperOptionsBuilder.js', () => ({
  buildChromeArgs: vi.fn(() => []),
  getChromeDataDir: vi.fn(() => '/mock/chrome'),
}));

vi.mock('../../../src/Scraper/CredentialsBuilder.js', () => ({
  default: vi.fn(() => ({ username: 'u', password: TEST_CREDENTIAL_SHORT })),
}));

vi.mock('../../../src/Services/TwoFactorService.js', () => ({
  default: vi.fn(() => ({
    createOtpRetriever: vi.fn(() => async () => '123456'),
  })),
}));

const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

const retryStrategy = {
  execute: vi.fn(async (fn: () => Promise<unknown>) => fn()),
};
const noRetryStrategy = {
  execute: vi.fn(async (fn: () => Promise<unknown>) => fn()),
};
const timeoutWrapper = { wrap: vi.fn(async (p: Promise<unknown>) => p) };
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
    telegramNotifier: null,
    notificationService: notificationService as never,
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

describe('LiveScrapeStrategy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    retryStrategy.execute.mockImplementation(
      async (fn: () => Promise<unknown>) => fn());
    noRetryStrategy.execute.mockImplementation(
      async (fn: () => Promise<unknown>) => fn());
    timeoutWrapper.wrap.mockImplementation(async (p: Promise<unknown>) => p);
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
});
