import { describe, it, expect } from 'vitest';
import { formatDate } from '../../src/utils/date.js';

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

    it('accepts an ISO date string', () => {
      const result = formatDate('2026-06-15T12:00:00Z');
      expect(result).toMatch(/^2026-06-1[45]$/); // Timezone may shift day
    });
  });
});
