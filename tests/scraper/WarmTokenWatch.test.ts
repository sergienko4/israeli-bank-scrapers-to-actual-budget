/**
 * WarmTokenWatch edge cases. The E2E suite `WarmStartReplay.e2e.test.ts` runs
 * the warnings through the shipped import for every API-direct bank; these
 * cases pin what it cannot reach.
 */

import { faker } from '@faker-js/faker';
import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';
import { describe, expect, it, vi } from 'vitest';

import type { ILogger } from '../../src/Logger/ILogger.js';
import type { IWarmTokenWatch } from '../../src/Scraper/Tokens/WarmTokenWatch.js';
import { warnIfNotAccepted, watchRetriever } from '../../src/Scraper/Tokens/WarmTokenWatch.js';

/**
 * Builds the watch of one attempt, with a logger whose warnings a case can read.
 * @param sentToken - Whether the attempt sent a long-term token.
 * @returns The watch.
 */
function watchOf(sentToken: boolean): IWarmTokenWatch {
  const logger: ILogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { storeKey: 'onezero:oneZero', logger, sentToken };
}

/**
 * Reads every warning a watch logged.
 * @param watch - The watch.
 * @returns The warnings, in order.
 */
function warningsOf(watch: IWarmTokenWatch): string[] {
  return vi.mocked(watch.logger.warn).mock.calls.map(([line]) => String(line));
}

/**
 * Builds a failed scrape.
 * @param errorType - Upstream's error type.
 * @returns The failure.
 */
function failedWith(errorType: string): IScraperScrapingResult {
  return { success: false, errorType, errorMessage: faker.lorem.sentence() } as IScraperScrapingResult;
}

describe('watchRetriever', () => {
  it('warns once when a login that sent a token asks for the code twice, and returns the code both times', async () => {
    const watch = watchOf(true);
    const code = faker.string.numeric(6);
    const retriever = watchRetriever(watch, () => Promise.resolve(code));

    const codes = [await retriever?.(), await retriever?.()];

    expect(codes).toEqual([code, code]);
    expect(warningsOf(watch)).toEqual([
      '  ⚠️  The long-term token for onezero:oneZero was not accepted, so this run logs in with an SMS code',
    ]);
  });

  it('does not warn when the login sent no token', async () => {
    const watch = watchOf(false);
    const retriever = watchRetriever(watch, () => Promise.resolve(faker.string.numeric(6)));

    await retriever?.();

    expect(warningsOf(watch)).toEqual([]);
  });

  it('adds no retriever to a login that cannot ask for a code', () => {
    expect(watchRetriever(watchOf(true), undefined)).toBeUndefined();
  });
});

describe('warnIfNotAccepted', () => {
  it('does not warn when the login sent no token', () => {
    const watch = watchOf(false);

    const hasWarned = warnIfNotAccepted(watch, failedWith('TWO_FACTOR_RETRIEVER_MISSING'));

    expect(hasWarned).toBe(false);
    expect(warningsOf(watch)).toEqual([]);
  });

  it.each(['INVALID_PASSWORD', 'INVALID_OTP', 'GENERIC'])('does not warn when a login that sent a token fails with %s', (
    errorType,
  ) => {
    const watch = watchOf(true);

    const hasWarned = warnIfNotAccepted(watch, failedWith(errorType));

    expect(hasWarned).toBe(false);
    expect(warningsOf(watch)).toEqual([]);
  });
});
