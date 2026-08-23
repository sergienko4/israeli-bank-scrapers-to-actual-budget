/**
 * Provider failure classification tests.
 *
 * These guard the retry contract: israeli-bank-scrapers reports failures by
 * resolving rather than throwing, so without this translation the retry
 * strategy never counted an attempt and "Attempt 1/3" only ever ran once.
 */
import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';
import { describe, expect, it } from 'vitest';

import {
  RetryableProviderFailure,
  isRetryableProviderFailure,
  throwIfRetryable,
} from '../../src/Scraper/Strategies/Live/ProviderFailure.js';

/**
 * Builds a provider failure result for a given error type.
 * @param errorType - Upstream ScraperErrorTypes wire string.
 * @param errorMessage - Optional provider error text.
 * @returns A failing provider result.
 */
function failure(errorType: string, errorMessage?: string): IScraperScrapingResult {
  return { success: false, errorType, errorMessage } as IScraperScrapingResult;
}

/**
 * Reproduces the INIT failure text the provider emits for a landing status.
 *
 * Copied verbatim from the provider's `landingFailureMessage` so this suite
 * fails loudly if the wording our classifier matches on ever drifts.
 * @param status - HTTP status the bank edge served for the landing document.
 * @returns The provider's INIT failure message for that status.
 */
function landingFailure(status: number): string {
  return (
    `INIT ACTION: bank edge served HTTP ${String(status)} for the landing ` +
    `document (https://www.example-bank.co.il/); no later phase can recover from it`
  );
}

describe('isRetryableProviderFailure', () => {
  it('does not retry a successful scrape', () => {
    const result = { success: true, accounts: [] } as unknown as IScraperScrapingResult;
    expect(isRetryableProviderFailure(result)).toBe(false);
  });

  it.each([
    'INVALID_PASSWORD',
    'CHANGE_PASSWORD',
    'ACCOUNT_BLOCKED',
    'INVALID_OTP',
    'TWO_FACTOR_RETRIEVER_MISSING',
  ])('does not retry the permanent failure %s', (errorType) => {
    expect(isRetryableProviderFailure(failure(errorType))).toBe(false);
  });

  it.each([
    'TIMEOUT',
    'NETWORK_ERROR',
    'GENERIC',
    'GENERAL_ERROR',
    'WAF_BLOCKED',
  ])('retries the transient failure %s', (errorType) => {
    expect(isRetryableProviderFailure(failure(errorType))).toBe(true);
  });

  it('retries an unrecognised error type rather than giving up', () => {
    expect(isRetryableProviderFailure(failure('SOMETHING_NEW'))).toBe(true);
  });

  it.each([404, 410])(
    'does not retry a landing document the bank edge reports gone (HTTP %i)',
    (status) => {
      expect(isRetryableProviderFailure(failure('GENERIC', landingFailure(status)))).toBe(false);
    },
  );

  it.each([403, 429, 503])(
    'still retries a challenge-capable landing status (HTTP %i)',
    (status) => {
      expect(isRetryableProviderFailure(failure('GENERIC', landingFailure(status)))).toBe(true);
    },
  );

  it('still retries a GENERIC failure unrelated to the landing document', () => {
    const result = failure('GENERIC', 'Hard-model scrape resolved zero accounts');
    expect(isRetryableProviderFailure(result)).toBe(true);
  });
});

describe('throwIfRetryable', () => {
  it('returns permanent failures untouched so they fail fast', () => {
    const result = failure('INVALID_PASSWORD', 'wrong password');
    expect(throwIfRetryable(result)).toBe(result);
  });

  it('returns a gone landing document untouched so it fails fast', () => {
    const result = failure('GENERIC', landingFailure(404));
    expect(throwIfRetryable(result)).toBe(result);
  });

  it('throws transient failures so the retry strategy counts them', () => {
    expect(() => throwIfRetryable(failure('WAF_BLOCKED'))).toThrow(RetryableProviderFailure);
  });

  it('preserves the provider result on the thrown error', () => {
    const result = failure('TIMEOUT', 'navigation timed out');
    try {
      throwIfRetryable(result);
      expect.unreachable('expected a RetryableProviderFailure');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(RetryableProviderFailure);
      expect((error as RetryableProviderFailure).result).toBe(result);
    }
  });

  it('uses the provider error text as the thrown message', () => {
    const result = failure('GENERIC', 'Hard-model scrape resolved zero accounts');
    expect(() => throwIfRetryable(result))
      .toThrow('Hard-model scrape resolved zero accounts');
  });

  it('falls back to the error type when the provider sends no message', () => {
    expect(() => throwIfRetryable(failure('NETWORK_ERROR')))
      .toThrow('Provider reported NETWORK_ERROR');
  });
});
