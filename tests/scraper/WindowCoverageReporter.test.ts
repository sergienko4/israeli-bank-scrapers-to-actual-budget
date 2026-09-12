import type {
  IScraperScrapingResult,
  IWindowCoverage,
} from '@sergienko4/israeli-bank-scrapers';
import { describe, expect, it, vi } from 'vitest';

import type { ILogger } from '../../src/Logger/ILogger.js';
import reportWindowCoverage from '../../src/Scraper/WindowCoverageReporter.js';

const ACCOUNT_MARKER = 'account-reference-must-not-leak';
const REQUESTED_START = '2026-01-01T00:00:00.000Z';

/**
 * Builds a logger with isolated spies for every severity.
 * @returns Logger used to inspect emitted coverage warnings.
 */
function makeLogger(): ILogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/**
 * Builds a successful provider result with one account per coverage entry.
 * @param coverages - Coverage states to attach to synthetic provider accounts.
 * @returns Provider result accepted by the reporting boundary.
 */
function successfulResult(
  coverages: readonly (IWindowCoverage | undefined)[],
): IScraperScrapingResult {
  const accounts = coverages.map((windowCoverage, index) => ({
    accountNumber: `${ACCOUNT_MARKER}-${String(index)}`,
    txns: [],
    windowCoverage,
  }));
  return { success: true, accounts };
}

describe('reportWindowCoverage', () => {
  it('does not warn when every assessed account is covered', () => {
    const logger = makeLogger();
    const result = successfulResult([{
      status: 'covered',
      requestedStart: REQUESTED_START,
      oldest: '2026-01-01',
    }]);

    const warned = reportWindowCoverage('pepper', result, logger);

    expect(warned).toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does not treat missing coverage metadata as a failure', () => {
    const logger = makeLogger();

    const warned = reportWindowCoverage('discount', successfulResult([undefined]), logger);

    expect(warned).toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does not warn when a failed provider result includes partial accounts', () => {
    const logger = makeLogger();
    const partial = successfulResult([{
      status: 'unproven',
      requestedStart: REQUESTED_START,
      reason: 'backfillCeilingReached',
    }]);
    const result: IScraperScrapingResult = {
      success: false,
      errorMessage: 'Provider request failed',
      accounts: partial.accounts,
    };

    const warned = reportWindowCoverage('discount', result, logger);

    expect(warned).toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('reports degraded account states in one aggregate warning', () => {
    const logger = makeLogger();
    const result = successfulResult([
      {
        status: 'lowerBoundReached',
        requestedStart: REQUESTED_START,
        oldest: '2026-01-01',
        caveats: ['mappingRejectedRows'],
      },
      {
        status: 'unproven',
        requestedStart: REQUESTED_START,
        oldest: '2026-01-08',
        gapDays: 7,
        reason: 'backfillCeilingReached',
      },
      {
        status: 'covered',
        requestedStart: REQUESTED_START,
        oldest: '2026-01-01',
      },
    ]);

    const warned = reportWindowCoverage('pepper', result, logger);

    expect(warned).toBe(true);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      'Scraper window coverage is incomplete; importing available transactions',
      {
        eventName: 'scrape_window_coverage_incomplete',
        bankId: 'pepper',
        assessedAccounts: 3,
        coveredAccounts: 1,
        lowerBoundReachedAccounts: 1,
        unprovenAccounts: 1,
      },
    );
  });

  it('does not include provider account identifiers in the warning', () => {
    const logger = makeLogger();
    const result = successfulResult([{
      status: 'unproven',
      requestedStart: REQUESTED_START,
      reason: 'noRowCarriedAUsableDate',
    }]);

    reportWindowCoverage('pepper', result, logger);

    expect(JSON.stringify((logger.warn as ReturnType<typeof vi.fn>).mock.calls))
      .not.toContain(ACCOUNT_MARKER);
  });
});
