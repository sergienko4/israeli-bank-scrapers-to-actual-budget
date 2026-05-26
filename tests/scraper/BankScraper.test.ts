/**
 * BankScraper coordinator tests.
 *
 * The class is now a thin coordinator that orchestrates Registry → Strategy
 * → Mapper. These tests exercise only that orchestration with mock
 * collaborators; provider-specific concerns live in their own test files:
 *   - BankRegistry.test.ts            — alias resolution
 *   - Policies/DateRangePolicy.test.ts — date math
 *   - Strategies/MockScrapeStrategy.test.ts
 *   - Strategies/LiveScrapeStrategy.test.ts
 *   - Mappers/DefaultScrapeResultMapper.test.ts
 *
 * The back-compat module-level functions (computeStartDate,
 * filterTransactionsByDate, isEmptyResultError, logScrapeFailure) are
 * also covered here to lock the public re-export surface.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';

import {
  BankScraper, computeStartDate, filterTransactionsByDate,
  isEmptyResultError, logScrapeFailure,
} from '../../src/Scraper/BankScraper.js';
import { createBankRegistry } from '../../src/Scraper/BankRegistry.js';
import createScrapeResultMapper from '../../src/Scraper/Mappers/DefaultScrapeResultMapper.js';
import { createDateRangePolicy } from '../../src/Scraper/Policies/DateRangePolicy.js';
import type { IBankScrapeStrategy } from '../../src/Scraper/Strategies/IBankScrapeStrategy.js';
import type { ILogger } from '../../src/Logger/ILogger.js';
import { fail, succeed } from '../../src/Types/Index.js';
import {
  fakeBankConfig, fakeBankTransactions,
} from '../helpers/factories.js';

const WAF_BLOCKED_ERROR_TYPE = 'WAF_BLOCKED' as unknown as IScraperScrapingResult['errorType'];
const GENERIC_ERROR_TYPE = 'GENERIC' as unknown as IScraperScrapingResult['errorType'];

// ── Logger mock ──────────────────────────────────────────────────────────────
const mockLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('../../src/Logger/Index.js', () => ({
  getLogger: () => mockLogger,
  createLogger: vi.fn(),
  getLogBuffer: vi.fn(),
}));

/**
 * Builds a minimal ILogger spy for coordinator tests.
 * @returns Fresh ILogger with vi.fn spies on info/debug/warn/error.
 */
function makeLogger(): ILogger {
  return { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/**
 * Constructs a BankScraper with default real collaborators plus a custom strategy.
 * @param strategy - The IBankScrapeStrategy implementation under test.
 * @returns Configured BankScraper ready for invocation.
 */
function makeScraper(strategy: IBankScrapeStrategy): BankScraper {
  return new BankScraper({
    registry: createBankRegistry(),
    strategy,
    mapper: createScrapeResultMapper(),
    datePolicy: createDateRangePolicy(),
    logger: makeLogger(),
  });
}

// ─── BankScraper coordinator ─────────────────────────────────────────────────

describe('BankScraper coordinator', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns success result mapped through the canonical layer', async () => {
    const strategy: IBankScrapeStrategy = {
      scrape: vi.fn().mockResolvedValue(succeed({
        bankId: 'discount', companyType: 'discount',
        attemptCount: 1, strategy: 'live',
        raw: { success: true, accounts: [{ accountNumber: '123', balance: 10, txns: [] }] },
      })),
    };
    const result = await makeScraper(strategy).scrapeBankWithResilience(
      'discount', fakeBankConfig());
    expect(result.success).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts?.[0].accountNumber).toBe('123');
  });

  it('delegates unknown banks to the strategy (e.g. mock fixtures)', async () => {
    const strategy: IBankScrapeStrategy = {
      scrape: vi.fn().mockResolvedValue(succeed({
        bankId: 'e2eTestBank', companyType: undefined,
        attemptCount: 1, strategy: 'mock',
        raw: { success: true, accounts: [{ accountNumber: '42', balance: 0, txns: [] }] },
      })),
    };
    const result = await makeScraper(strategy).scrapeBankWithResilience(
      'e2eTestBank', fakeBankConfig());
    expect(strategy.scrape).toHaveBeenCalledTimes(1);
    const callArg = (strategy.scrape as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.bankId).toBe('e2eTestBank');
    expect(callArg.companyType).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.accounts?.[0].accountNumber).toBe('42');
  });

  it('propagates strategy failure for unknown bank in live mode', async () => {
    const strategy: IBankScrapeStrategy = {
      scrape: vi.fn().mockResolvedValue(
        fail('Unknown bank: unknownXYZ', { status: 'unknown-bank' })),
    };
    const result = await makeScraper(strategy).scrapeBankWithResilience(
      'unknownXYZ', fakeBankConfig());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('Unknown bank: unknownXYZ');
    expect(strategy.scrape).toHaveBeenCalledTimes(1);
  });

  it('returns failure result when strategy fails', async () => {
    const strategy: IBankScrapeStrategy = {
      scrape: vi.fn().mockResolvedValue(fail('Invalid mock scraper file: bad.json')),
    };
    const result = await makeScraper(strategy).scrapeBankWithResilience(
      'discount', fakeBankConfig());
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('Invalid mock');
  });

  it('passes resolved companyType + startDate to the strategy', async () => {
    const strategy: IBankScrapeStrategy = {
      scrape: vi.fn().mockResolvedValue(succeed({
        bankId: 'visacal', companyType: 'visaCal',
        attemptCount: 1, strategy: 'mock',
        raw: { success: true, accounts: [] },
      })),
    };
    await makeScraper(strategy).scrapeBankWithResilience(
      'visaCal', fakeBankConfig({ daysBack: 7 }));
    const callArg = (strategy.scrape as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg.bankId).toBe('visacal');
    expect(callArg.companyType).toBe('visaCal');
    expect(callArg.startDate).toBeInstanceOf(Date);
  });

  it('applies sign flip via mapper for credit-card banks (visaCal)', async () => {
    const strategy: IBankScrapeStrategy = {
      scrape: vi.fn().mockResolvedValue(succeed({
        bankId: 'visacal', companyType: 'visaCal',
        attemptCount: 1, strategy: 'live',
        raw: { success: true, accounts: [{
          accountNumber: '9999', balance: 0,
          txns: [{ chargedAmount: 100, originalAmount: 50, date: '2026-01-01' }],
        }] },
      })),
    };
    const result = await makeScraper(strategy).scrapeBankWithResilience(
      'visaCal', fakeBankConfig());
    expect(result.accounts?.[0].txns[0].chargedAmount).toBe(-100);
    expect(result.accounts?.[0].txns[0].originalAmount).toBe(-50);
  });

  it('does NOT flip signs for non-credit-card banks (discount)', async () => {
    const strategy: IBankScrapeStrategy = {
      scrape: vi.fn().mockResolvedValue(succeed({
        bankId: 'discount', companyType: 'discount',
        attemptCount: 1, strategy: 'live',
        raw: { success: true, accounts: [{
          accountNumber: '9999', balance: 0,
          txns: [{ chargedAmount: 100, originalAmount: 50, date: '2026-01-01' }],
        }] },
      })),
    };
    const result = await makeScraper(strategy).scrapeBankWithResilience(
      'discount', fakeBankConfig());
    expect(result.accounts?.[0].txns[0].chargedAmount).toBe(100);
    expect(result.accounts?.[0].txns[0].originalAmount).toBe(50);
  });
});

// ─── computeStartDate (back-compat shim) ─────────────────────────────────────

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

// ─── filterTransactionsByDate (back-compat shim) ─────────────────────────────

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
    expect(isEmptyResultError({
      success: false, errorMessage: 'no transactions found', accounts: [],
    })).toBe(true);
  });

  it('returns true for "no results found"', () => {
    expect(isEmptyResultError({
      success: false, errorMessage: 'no results found', accounts: [],
    })).toBe(true);
  });

  it('returns true for Hebrew "no transactions" message', () => {
    expect(isEmptyResultError({
      success: false, errorMessage: 'לא מצאנו תנועות', accounts: [],
    })).toBe(true);
  });

  it('returns false for a real error message', () => {
    expect(isEmptyResultError({
      success: false, errorMessage: 'Login failed', accounts: [],
    })).toBe(false);
  });

  it('returns false when errorMessage is undefined', () => {
    expect(isEmptyResultError({ success: false, accounts: [] })).toBe(false);
  });
});

// ─── logScrapeFailure ────────────────────────────────────────────────────────

describe('logScrapeFailure', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs the error message with WAF hint', () => {
    logScrapeFailure('leumi', {
      success: false, errorType: WAF_BLOCKED_ERROR_TYPE,
      errorMessage: 'blocked', accounts: [],
    });
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Wait 1-2 hours'));
  });

  it('logs without hint for unknown error type', () => {
    logScrapeFailure('leumi', {
      success: false, errorType: GENERIC_ERROR_TYPE,
      errorMessage: 'oops', accounts: [],
    });
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('oops'));
  });

  it('logs "Unknown error" when errorMessage is missing', () => {
    logScrapeFailure('leumi', { success: false, accounts: [] });
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Unknown error'));
  });
});
