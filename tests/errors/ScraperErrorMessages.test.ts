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

    it('returns advice for all known codes', () => {
      for (const code of Object.keys(SCRAPER_ERROR_ADVICE)) {
        expect(getScraperErrorAdvice(code)).toBeDefined();
      }
    });

    it('returns undefined for unknown error text', () => {
      expect(getScraperErrorAdvice('SOME_RANDOM_ERROR')).toBe('');
    });

    it('returns undefined for empty string', () => {
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
  });
});
