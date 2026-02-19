import { describe, it, expect } from 'vitest';
import { toCents, fromCents } from '../../src/utils/currency.js';

describe('currency utils', () => {
  describe('toCents', () => {
    it('converts whole numbers', () => {
      expect(toCents(100)).toBe(10000);
    });

    it('converts decimal amounts', () => {
      expect(toCents(50.55)).toBe(5055);
    });

    it('handles zero', () => {
      expect(toCents(0)).toBe(0);
    });

    it('handles negative amounts', () => {
      expect(toCents(-50.55)).toBe(-5055);
    });

    it('rounds correctly for floating point edge cases', () => {
      expect(toCents(19.999)).toBe(2000);
    });

    it('handles small values', () => {
      expect(toCents(0.01)).toBe(1);
    });

    it('handles large values', () => {
      expect(toCents(999999.99)).toBe(99999999);
    });
  });

  describe('fromCents', () => {
    it('converts cents to currency units', () => {
      expect(fromCents(10000)).toBe(100);
    });

    it('handles zero', () => {
      expect(fromCents(0)).toBe(0);
    });

    it('handles negative cents', () => {
      expect(fromCents(-5055)).toBe(-50.55);
    });

    it('handles single cent', () => {
      expect(fromCents(1)).toBe(0.01);
    });
  });
});
