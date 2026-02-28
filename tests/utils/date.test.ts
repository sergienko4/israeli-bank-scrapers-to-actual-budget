import { describe, it, expect } from 'vitest';
import { formatDate } from '../../src/Utils/date.js';

describe('date utils', () => {
  describe('formatDate', () => {
    it('formats a Date object as YYYY-MM-DD', () => {
      const date = new Date(2026, 0, 15); // January 15, 2026
      expect(formatDate(date)).toBe('2026-01-15');
    });

    it('pads single digit month', () => {
      const date = new Date(2026, 0, 5); // January 5
      expect(formatDate(date)).toBe('2026-01-05');
    });

    it('pads single digit day', () => {
      const date = new Date(2026, 8, 3); // September 3
      expect(formatDate(date)).toBe('2026-09-03');
    });

    it('handles December correctly', () => {
      const date = new Date(2026, 11, 31); // December 31
      expect(formatDate(date)).toBe('2026-12-31');
    });

    it('accepts a date string', () => {
      expect(formatDate('2026-02-19')).toMatch(/^2026-02-19$/);
    });

    it('accepts an ISO date string and uses Jerusalem timezone', () => {
      // 12:00 UTC = 14:00 Jerusalem — always June 15 in Jerusalem
      expect(formatDate('2026-06-15T12:00:00Z')).toBe('2026-06-15');
    });

    it('scraper midnight regression: UTC "prev day" maps to correct Jerusalem date', () => {
      // Scrapers store Jerusalem midnight as UTC prev-day
      // Feb 15 midnight Israel = 2026-02-14T22:00:00.000Z
      // Must return 2026-02-15, not 2026-02-14
      expect(formatDate('2026-02-14T22:00:00.000Z')).toBe('2026-02-15');
    });
  });
});
