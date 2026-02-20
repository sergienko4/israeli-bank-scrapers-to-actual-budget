import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TranslateCategoryResolver } from '../../src/services/TranslateCategoryResolver.js';
import { TranslationRule } from '../../src/types/index.js';

describe('TranslateCategoryResolver', () => {
  let resolver: TranslateCategoryResolver;

  const sampleRules: TranslationRule[] = [
    { fromPayee: 'סופר', toPayee: 'Supermarket' },
    { fromPayee: 'שופרסל', toPayee: 'Shufersal' },
    { fromPayee: 'רמי לוי', toPayee: 'Rami Levy' },
    { fromPayee: 'דלק', toPayee: 'Gas Station' },
    { fromPayee: 'חשמל', toPayee: 'Electric Company' }
  ];

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    resolver = new TranslateCategoryResolver(sampleRules);
  });

  describe('initialize', () => {
    it('logs the number of loaded rules', async () => {
      await resolver.initialize();
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('5 rules')
      );
    });
  });

  describe('resolve', () => {
    it('translates Hebrew payee to English', () => {
      const result = resolver.resolve('דלק פז רחובות');
      expect(result).toEqual({
        payeeName: 'Gas Station',
        importedPayee: 'דלק פז רחובות'
      });
    });

    it('returns undefined for unmatched payee', () => {
      expect(resolver.resolve('מסעדה כלשהי')).toBeUndefined();
    });

    it('preserves original description in importedPayee', () => {
      const result = resolver.resolve('חשמל ישראל');
      expect(result?.importedPayee).toBe('חשמל ישראל');
      expect(result?.payeeName).toBe('Electric Company');
    });

    it('matches longest rule first (שופרסל before סופר)', () => {
      const result = resolver.resolve('שופרסל דיזנגוף');
      expect(result?.payeeName).toBe('Shufersal');
    });

    it('falls back to shorter match for non-specific text', () => {
      const result = resolver.resolve('סופר כל הטעמים');
      expect(result?.payeeName).toBe('Supermarket');
    });

    it('is case-insensitive for English descriptions', () => {
      const rules: TranslationRule[] = [{ fromPayee: 'store', toPayee: 'General Store' }];
      const eng = new TranslateCategoryResolver(rules);
      expect(eng.resolve('STORE checkout')).toEqual({
        payeeName: 'General Store',
        importedPayee: 'STORE checkout'
      });
    });

    it('handles empty translations array', () => {
      const empty = new TranslateCategoryResolver([]);
      expect(empty.resolve('שופרסל')).toBeUndefined();
    });

    it('handles empty description', () => {
      expect(resolver.resolve('')).toBeUndefined();
    });

    it('does not set categoryId (translate mode only sets payeeName)', () => {
      const result = resolver.resolve('רמי לוי תל אביב');
      expect(result?.categoryId).toBeUndefined();
      expect(result?.payeeName).toBe('Rami Levy');
    });

    it('matches when fromPayee is at the start of description', () => {
      expect(resolver.resolve('סופר')).toEqual({
        payeeName: 'Supermarket',
        importedPayee: 'סופר'
      });
    });
  });
});
