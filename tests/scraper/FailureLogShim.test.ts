/**
 * FailureLogShim unit tests — exercises the extracted `logScrapeFailure`
 * helper in isolation.
 *
 * The same function is also re-exported from BankScraper.ts and covered
 * indirectly by BankScraper.test.ts; these tests pin the behaviour at the
 * dedicated module's public surface so a future deletion of the BankScraper
 * re-export (planned for Phase-3) does not lose coverage.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';

const mockLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('../../src/Logger/Index.js', () => ({
  getLogger: () => mockLogger,
}));

const { default: logScrapeFailure } = await import('../../src/Scraper/FailureLogShim.js');

const WAF_BLOCKED_ERROR_TYPE = 'WAF_BLOCKED' as unknown as IScraperScrapingResult['errorType'];
const UNKNOWN_ERROR_TYPE = 'UNKNOWN_ERROR_TYPE_FOR_TEST' as unknown as IScraperScrapingResult['errorType'];

describe('FailureLogShim.logScrapeFailure', () => {
  beforeEach(() => {
    mockLogger.error.mockReset();
  });

  it('returns succeed({status: "logged"}) on every call', () => {
    const result: IScraperScrapingResult = {
      success: false, errorType: undefined, errorMessage: 'boom', accounts: [],
    };
    const out = logScrapeFailure('hapoalim', result);
    expect(out.success).toBe(true);
    expect(out.data.status).toBe('logged');
  });

  it('includes the bank name and base error message in the log line', () => {
    const result: IScraperScrapingResult = {
      success: false, errorType: undefined, errorMessage: 'login failed', accounts: [],
    };
    logScrapeFailure('discount', result);
    expect(mockLogger.error).toHaveBeenCalledOnce();
    const line = mockLogger.error.mock.calls[0][0] as string;
    expect(line).toContain('discount');
    expect(line).toContain('login failed');
  });

  it('falls back to "Unknown error" when errorMessage is missing', () => {
    const result: IScraperScrapingResult = {
      success: false, errorType: undefined, errorMessage: undefined, accounts: [],
    };
    logScrapeFailure('hapoalim', result);
    const line = mockLogger.error.mock.calls[0][0] as string;
    expect(line).toContain('Unknown error');
  });

  it('appends advice text when the errorType has a known scraper advice mapping', () => {
    const result: IScraperScrapingResult = {
      success: false,
      errorType: WAF_BLOCKED_ERROR_TYPE,
      errorMessage: 'access denied',
      accounts: [],
    };
    logScrapeFailure('hapoalim', result);
    const line = mockLogger.error.mock.calls[0][0] as string;
    expect(line).toContain('access denied');
    expect(line.length).toBeGreaterThan('access denied'.length + 'hapoalim'.length);
  });

  it('omits advice suffix when errorType is unrecognised', () => {
    const result: IScraperScrapingResult = {
      success: false,
      errorType: UNKNOWN_ERROR_TYPE,
      errorMessage: 'mystery',
      accounts: [],
    };
    logScrapeFailure('hapoalim', result);
    const line = mockLogger.error.mock.calls[0][0] as string;
    expect(line).toContain('mystery');
    expect(line.endsWith('mystery')).toBe(true);
  });
});
