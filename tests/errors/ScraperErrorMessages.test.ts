import { describe, it, expect } from 'vitest';
import {
  SCRAPER_ERROR_ADVICE,
  getScraperErrorAdvice,
} from '../../src/Errors/ScraperErrorMessages.js';

describe('ScraperErrorMessages', () => {
  describe('getScraperErrorAdvice', () => {
    it('returns advice for INVALID_PASSWORD', () => {
      const advice = getScraperErrorAdvice('INVALID_PASSWORD');
      expect(advice).toContain('Password incorrect');
      expect(advice).toContain('Verify your password');
    });

    it('returns advice for CHANGE_PASSWORD', () => {
      const advice = getScraperErrorAdvice('CHANGE_PASSWORD');
      expect(advice).toContain('password change');
    });

    it('returns advice for WAF_BLOCKED', () => {
      const advice = getScraperErrorAdvice('WAF_BLOCKED');
      expect(advice).toContain('Wait 1-2 hours');
    });

    it('returns advice for GENERIC_ERROR', () => {
      const advice = getScraperErrorAdvice('GENERIC_ERROR');
      expect(advice).toContain('unexpectedly');
    });

    // The provider's ScraperErrorTypes enum spells its catch-all buckets
    // "GENERIC" and "GENERAL_ERROR" on the wire. FailureLogShim feeds this
    // lookup `${errorType} ${message}`, so those are the strings that
    // actually arrive — never the longer "GENERIC_ERROR" spelling.
    it.each(['GENERIC', 'GENERAL_ERROR'])(
      'returns advice for the %s wire value the provider actually sends',
      (errorType) => {
        expect(getScraperErrorAdvice(`${errorType} boom`)).toContain('unexpectedly');
      },
    );

    it('still prefers a specific code over the catch-all bucket', () => {
      const advice = getScraperErrorAdvice('INVALID_PASSWORD rejected during GENERIC phase');
      expect(advice).toContain('Password incorrect');
      expect(advice).not.toContain('unexpectedly');
    });

    it('returns advice for all known codes', () => {
      for (const code of Object.keys(SCRAPER_ERROR_ADVICE)) {
        expect(getScraperErrorAdvice(code)).toBeDefined();
      }
    });

    it('returns empty string for unknown error text', () => {
      expect(getScraperErrorAdvice('SOME_RANDOM_ERROR')).toBe('');
    });

    it('returns empty string for empty string', () => {
      expect(getScraperErrorAdvice('')).toBe('');
    });

    it('matches code embedded in longer error message', () => {
      const advice = getScraperErrorAdvice('Error: INVALID_PASSWORD at login');
      expect(advice).toContain('Password incorrect');
    });

    it('does not false-positive on partial match', () => {
      expect(getScraperErrorAdvice('PASSWORD_RESET')).toBe('');
      expect(getScraperErrorAdvice('BLOCK')).toBe('');
      expect(getScraperErrorAdvice('TIME')).toBe('');
    });

    it('returns advice for TWO_FACTOR_RETRIEVER_MISSING', () => {
      const advice = getScraperErrorAdvice('TWO_FACTOR_RETRIEVER_MISSING');
      expect(advice).toContain('no way to collect one was configured');
      expect(advice).toContain('twoFactorAuth: true');
    });
  });

  describe('upstream failure signatures', () => {
    const ZERO_ACCOUNTS = 'GENERIC Hard-model scrape resolved zero accounts — the '
      + 'post-login session is invalid or the accounts response was rejected (a bank '
      + 'error envelope or a non-200). Re-authenticate; a logged-in customer always '
      + 'has at least one account.';

    it('explains a zero-account scrape as a bank-side fault, not bad credentials', () => {
      const advice = getScraperErrorAdvice(ZERO_ACCOUNTS);
      expect(advice).toContain('Signed in, but the bank returned no accounts');
      expect(advice).toContain('credentials are fine');
    });

    it('does not tell the user to re-check their password', () => {
      const advice = getScraperErrorAdvice(ZERO_ACCOUNTS);
      expect(advice).not.toContain('Password incorrect');
      expect(advice).not.toContain('Verify your password');
    });

    it('matches the signature regardless of case', () => {
      expect(getScraperErrorAdvice('RESOLVED ZERO ACCOUNTS')).toContain('bank returned no accounts');
    });

    it('prefers a message signature over a catch-all error code', () => {
      const advice = getScraperErrorAdvice(`GENERIC_ERROR ${ZERO_ACCOUNTS}`);
      expect(advice).toContain('bank returned no accounts');
      expect(advice).not.toContain('unexpectedly');
    });

    it('still falls back to code advice when no signature matches', () => {
      const advice = getScraperErrorAdvice('INVALID_PASSWORD scrape produced no rows');
      expect(advice).toContain('Password incorrect');
    });

    it('does not fire on unrelated account wording', () => {
      expect(getScraperErrorAdvice('found zero transactions in the account')).toBe('');
    });
  });

  /**
   * Scraper 8.6.9 (upstream PR #530) added an INIT guard for a bank edge that
   * serves a branded 404 under HTTP 200. It is raised as ScraperErrorTypes
   * .Generic, so without a signature it lands in the catch-all bucket and the
   * operator is told the "bank website may have changed" — which sends them
   * looking for a scraper update for what is a transient bank-side fault.
   */
  describe('soft-404 landing document (scraper 8.6.9)', () => {
    // Copied verbatim from the provider's errorDocumentMessage() so this
    // suite fails loudly if the wording our signature matches on drifts.
    const SOFT_404 =
      'GENERIC INIT_ERROR_DOCUMENT: bank edge served an error document, '
      + 'not the bank page (https://www.example-bank.co.il/)';

    it('explains the failure as a bank-side error page', () => {
      const advice = getScraperErrorAdvice(SOFT_404);
      expect(advice).toContain('error page');
    });

    it('does not blame a stale scraper for a transient bank fault', () => {
      const advice = getScraperErrorAdvice(SOFT_404);
      expect(advice).not.toContain('check for scraper updates');
    });

    it('does not fire on an ordinary GENERIC failure', () => {
      const advice = getScraperErrorAdvice('GENERIC navigation timed out');
      expect(advice).not.toContain('error page');
    });
  });
});
