import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import {
  computeStartDate,
  filterTransactionsByDate,
  isEmptyResultError,
  logScrapeFailure,
  BankScraper,
} from '../../src/Scraper/BankScraper.js';
import { fakeBankConfig, fakeBankTransactions, fakeImporterConfig } from '../helpers/factories.js';

// ── Logger mock ──────────────────────────────────────────────────────────────
const mockLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('../../src/Logger/Index.js', () => ({
  getLogger: () => mockLogger,
  createLogger: vi.fn(),
  getLogBuffer: vi.fn(),
}));

// ── fs mock ──────────────────────────────────────────────────────────────────
vi.mock('node:fs');

// ── Scraper library mock ─────────────────────────────────────────────────────
const mockScraper = { scrape: vi.fn() };
vi.mock('@sergienko4/israeli-bank-scrapers', () => ({
  createScraper: vi.fn(() => mockScraper),
  CompanyTypes: {
    Hapoalim: 'hapoalim', Leumi: 'leumi', Discount: 'discount',
    Mizrahi: 'mizrahi', Mercantile: 'mercantile', OtsarHahayal: 'otsarHahayal',
    Beinleumi: 'beinleumi', Massad: 'massad', Yahav: 'yahav',
    VisaCal: 'visaCal', Max: 'max', Isracard: 'isracard',
    Amex: 'amex', BeyahadBishvilha: 'beyahadBishvilha',
    Behatsdaa: 'behatsdaa', Pagi: 'pagi', OneZero: 'oneZero',
  },
}));

// ── ScraperOptionsBuilder mock ───────────────────────────────────────────────
vi.mock('../../src/Scraper/ScraperOptionsBuilder.js', () => ({
  buildChromeArgs: vi.fn(() => []),
  getChromeDataDir: vi.fn(() => '/mock/chrome'),
}));

// ── CredentialsBuilder mock ──────────────────────────────────────────────────
vi.mock('../../src/Scraper/CredentialsBuilder.js', () => ({
  buildCredentials: vi.fn(() => ({ username: 'u', password: 'p' })),
}));

// ── TwoFactorService mock ────────────────────────────────────────────────────
vi.mock('../../src/Services/TwoFactorService.js', () => ({
  TwoFactorService: vi.fn(() => ({
    createOtpRetriever: vi.fn(() => async () => '123456'),
  })),
}));

// ─── computeStartDate ────────────────────────────────────────────────────────

describe('computeStartDate', () => {
  it('returns today minus (daysBack - 1) when daysBack is set', () => {
    const config = fakeBankConfig({ daysBack: 7, startDate: undefined });
    const result = computeStartDate(config);
    const expected = new Date();
    expected.setDate(expected.getDate() - 6);
    expect(result.toDateString()).toBe(expected.toDateString());
  });

  it('parses startDate string when provided', () => {
    const config = fakeBankConfig({ daysBack: undefined, startDate: '2026-01-01' });
    const result = computeStartDate(config);
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(0);
  });

  it('returns today when neither daysBack nor startDate is set', () => {
    const config = fakeBankConfig({ daysBack: undefined, startDate: undefined });
    const result = computeStartDate(config);
    expect(result.toDateString()).toBe(new Date().toDateString());
  });
});

// ─── filterTransactionsByDate ────────────────────────────────────────────────

describe('filterTransactionsByDate', () => {
  it('returns all transactions when no date config is set', () => {
    const config = fakeBankConfig({ daysBack: undefined, startDate: undefined });
    const txns = fakeBankTransactions(3);
    expect(filterTransactionsByDate(txns, config)).toHaveLength(3);
  });

  it('filters out transactions before the cutoff date', () => {
    const config = fakeBankConfig({ daysBack: 7, startDate: undefined });
    const recent = { date: new Date().toISOString() };
    const old = { date: '2000-01-01' };
    const result = filterTransactionsByDate([recent, old], config);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(recent);
  });
});

// ─── isEmptyResultError ──────────────────────────────────────────────────────

describe('isEmptyResultError', () => {
  it('returns true for "no transactions found"', () => {
    expect(isEmptyResultError({ success: false, errorMessage: 'no transactions found', accounts: [] })).toBe(true);
  });

  it('returns true for "no results found"', () => {
    expect(isEmptyResultError({ success: false, errorMessage: 'no results found', accounts: [] })).toBe(true);
  });

  it('returns true for Hebrew "no transactions" message', () => {
    expect(isEmptyResultError({ success: false, errorMessage: 'לא מצאנו תנועות', accounts: [] })).toBe(true);
  });

  it('returns false for a real error message', () => {
    expect(isEmptyResultError({ success: false, errorMessage: 'Login failed', accounts: [] })).toBe(false);
  });

  it('returns false when errorMessage is undefined', () => {
    expect(isEmptyResultError({ success: false, accounts: [] })).toBe(false);
  });
});

// ─── logScrapeFailure ────────────────────────────────────────────────────────

describe('logScrapeFailure', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs the error message with WAF hint', () => {
    logScrapeFailure('leumi', { success: false, errorType: 'WAF_BLOCKED', errorMessage: 'blocked', accounts: [] });
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Wait 1-2 hours')
    );
  });

  it('logs without hint for unknown error type', () => {
    logScrapeFailure('leumi', { success: false, errorType: 'UNKNOWN', errorMessage: 'oops', accounts: [] });
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('oops'));
  });

  it('logs "Unknown error" when errorMessage is missing', () => {
    logScrapeFailure('leumi', { success: false, accounts: [] });
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Unknown error'));
  });
});

// ─── BankScraper class ───────────────────────────────────────────────────────

describe('BankScraper', () => {
  const VALID_MOCK_RESULT = JSON.stringify({ success: true, accounts: [] });
  const mockRetryStrategy = {
    execute: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  };
  const mockTimeoutWrapper = {
    wrap: vi.fn(async (p: Promise<unknown>) => p),
  };
  const mockNotificationService = { sendMessage: vi.fn(), sendSummary: vi.fn(), sendError: vi.fn() };

  const makeOpts = () => ({
    config: fakeImporterConfig(),
    retryStrategy: mockRetryStrategy,
    noRetryStrategy: mockRetryStrategy,
    timeoutWrapper: mockTimeoutWrapper,
    telegramNotifier: null,
    notificationService: mockNotificationService,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns mock result from E2E_MOCK_SCRAPER_FILE env', async () => {
    vi.stubEnv('E2E_MOCK_SCRAPER_FILE', '/mock/data.json');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(VALID_MOCK_RESULT);

    const scraper = new BankScraper(makeOpts());
    const result = await scraper.scrapeBankWithResilience('discount', fakeBankConfig());

    expect(result.success).toBe(true);
    expect(mockRetryStrategy.execute).not.toHaveBeenCalled();
  });

  it('returns per-bank mock file from E2E_MOCK_SCRAPER_DIR when file exists', async () => {
    vi.stubEnv('E2E_MOCK_SCRAPER_DIR', '/mock/dir');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(VALID_MOCK_RESULT);

    const scraper = new BankScraper(makeOpts());
    const result = await scraper.scrapeBankWithResilience('discount', fakeBankConfig());

    expect(result.success).toBe(true);
  });

  it('falls back to default.json when per-bank file does not exist in mock dir', async () => {
    vi.stubEnv('E2E_MOCK_SCRAPER_DIR', '/mock/dir');
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockReturnValue(VALID_MOCK_RESULT);

    const scraper = new BankScraper(makeOpts());
    const result = await scraper.scrapeBankWithResilience('discount', fakeBankConfig());

    expect(result.success).toBe(true);
  });

  it('delegates to retryStrategy.execute for a normal scrape', async () => {
    const mockResult = { success: true, accounts: [] };
    mockScraper.scrape.mockResolvedValue(mockResult);

    const scraper = new BankScraper(makeOpts());
    const result = await scraper.scrapeBankWithResilience(
      'discount', fakeBankConfig({ daysBack: 7 })
    );

    expect(mockRetryStrategy.execute).toHaveBeenCalled();
    expect(result).toEqual(mockResult);
  });

  it('retries once on INVALID_OTP', async () => {
    const otpResult = { success: false, errorType: 'INVALID_OTP', accounts: [] };
    const successResult = { success: true, accounts: [] };
    mockScraper.scrape
      .mockResolvedValueOnce(otpResult)
      .mockResolvedValueOnce(successResult);

    const scraper = new BankScraper(makeOpts());
    const result = await scraper.scrapeBankWithResilience(
      'discount', fakeBankConfig({ daysBack: 7 })
    );

    expect(mockNotificationService.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('rejected')
    );
    expect(result).toEqual(successResult);
  });

  it('throws on unknown bank name', async () => {
    const scraper = new BankScraper(makeOpts());
    await expect(
      scraper.scrapeBankWithResilience('unknownXYZ', fakeBankConfig())
    ).rejects.toThrow('Unknown bank: unknownXYZ');
  });

  it('throws when mock file has invalid structure', async () => {
    vi.stubEnv('E2E_MOCK_SCRAPER_FILE', '/mock/bad.json');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ bad: true }));

    const scraper = new BankScraper(makeOpts());
    await expect(
      scraper.scrapeBankWithResilience('discount', fakeBankConfig())
    ).rejects.toThrow('Invalid mock scraper file');
  });

  it('clears bank session when clearSession is set', async () => {
    const mockResult = { success: true, accounts: [] };
    mockScraper.scrape.mockResolvedValue(mockResult);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.rmSync).mockReturnValue(undefined);

    const scraper = new BankScraper(makeOpts());
    await scraper.scrapeBankWithResilience(
      'discount', fakeBankConfig({ daysBack: 7, clearSession: true })
    );

    expect(fs.rmSync).toHaveBeenCalled();
  });

  it('uses noRetryStrategy for twoFactorAuth banks', async () => {
    const noRetry = { execute: vi.fn(async (fn: () => Promise<unknown>) => fn()) };
    const opts = { ...makeOpts(), noRetryStrategy: noRetry };
    mockScraper.scrape.mockResolvedValue({ success: true, accounts: [] });

    const scraper = new BankScraper(opts);
    await scraper.scrapeBankWithResilience(
      'discount', fakeBankConfig({ daysBack: 7, twoFactorAuth: true })
    );

    expect(noRetry.execute).toHaveBeenCalled();
  });
});
