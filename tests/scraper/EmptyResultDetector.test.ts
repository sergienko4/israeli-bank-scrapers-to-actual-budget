/**
 * EmptyResultDetector — unit tests.
 *
 * Validates the pattern-based classifier that distinguishes "no transactions
 * found" responses from genuine scraper failures. Edge cases include missing
 * errorMessage, mixed-case input, Hebrew patterns, and substring placement.
 */

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';
import { describe, expect, it } from 'vitest';

import isEmptyResultError from '../../src/Scraper/EmptyResultDetector.js';

const FAILED: Pick<IScraperScrapingResult, 'success' | 'accounts'> = {
  success: false, accounts: [],
};

function withMessage(msg: string | undefined): IScraperScrapingResult {
  return { ...FAILED, errorMessage: msg } as IScraperScrapingResult;
}

describe('EmptyResultDetector', () => {
  describe('English patterns', () => {
    it('matches "no transactions found" exactly', () => {
      expect(isEmptyResultError(withMessage('no transactions found'))).toBe(true);
    });

    it('matches "no results found" exactly', () => {
      expect(isEmptyResultError(withMessage('no results found'))).toBe(true);
    });

    it('matches case-insensitively (uppercase)', () => {
      expect(isEmptyResultError(withMessage('NO TRANSACTIONS FOUND'))).toBe(true);
    });

    it('matches case-insensitively (mixed case)', () => {
      expect(isEmptyResultError(withMessage('No Transactions Found'))).toBe(true);
    });

    it('matches when pattern is embedded in a longer message', () => {
      expect(isEmptyResultError(
        withMessage('Login OK, but no transactions found in date range'),
      )).toBe(true);
    });
  });

  describe('Hebrew pattern', () => {
    it('matches "לא מצאנו תנועות" exactly', () => {
      expect(isEmptyResultError(withMessage('לא מצאנו תנועות'))).toBe(true);
    });

    it('matches Hebrew embedded in longer message', () => {
      expect(isEmptyResultError(
        withMessage('שגיאה: לא מצאנו תנועות בתאריכים אלה'),
      )).toBe(true);
    });
  });

  describe('Non-matching errors (return false)', () => {
    it('returns false for unrelated error message', () => {
      expect(isEmptyResultError(withMessage('Invalid credentials'))).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isEmptyResultError(withMessage(''))).toBe(false);
    });

    it('returns false for undefined errorMessage', () => {
      expect(isEmptyResultError(withMessage(undefined))).toBe(false);
    });

    it('returns false for partial match that does not span full pattern', () => {
      expect(isEmptyResultError(withMessage('no transactions'))).toBe(false);
    });

    it('returns false for a generic timeout error', () => {
      expect(isEmptyResultError(withMessage('Request timed out after 30s'))).toBe(false);
    });
  });
});
