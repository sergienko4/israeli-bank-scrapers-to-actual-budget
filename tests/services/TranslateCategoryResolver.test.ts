import { describe, it, expect, beforeEach, vi } from 'vitest';
import TranslateCategoryResolver from '../../src/Services/TranslateCategoryResolver.js';
import { ITranslationRule } from '../../src/Types/Index.js';
import * as LoggerModule from '../../src/Logger/Index.js';

const mockLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('TranslateCategoryResolver', () => {
  let resolver: TranslateCategoryResolver;

  const sampleRules: ITranslationRule[] = [
    { fromPayee: 'סופר', toPayee: 'Supermarket' },
    { fromPayee: 'שופרסל', toPayee: 'Shufersal' },
    { fromPayee: 'רמי לוי', toPayee: 'Rami Levy' },
    { fromPayee: 'דלק', toPayee: 'Gas Station' },
    { fromPayee: 'חשמל', toPayee: 'Electric Company' }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(LoggerModule, 'getLogger').mockReturnValue(mockLogger as any);
    resolver = new TranslateCategoryResolver(sampleRules);
  });

  describe('initialize', () => {
    it('logs the number of loaded rules', async () => {
      await resolver.initialize();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('5 rules')
      );
    });
  });

  describe('resolve', () => {
    it('translates Hebrew payee to English', () => {
      const result = resolver.resolve('דלק פז רחובות');
      expect(result.success).toBe(true);
      expect((result as any).data).toEqual({
        payeeName: 'Gas Station',
        importedPayee: 'דלק פז רחובות'
      });
    });

    it('returns undefined for unmatched payee', () => {
      const result = resolver.resolve('מסעדה כלשהי');
      expect(result.success).toBe(false);
    });

    it('preserves original description in importedPayee', () => {
      const result = resolver.resolve('חשמל ישראל');
      expect(result.success).toBe(true);
      expect((result as any).data.importedPayee).toBe('חשמל ישראל');
      expect((result as any).data.payeeName).toBe('Electric Company');
    });

    it('matches longest rule first (שופרסל before סופר)', () => {
      const result = resolver.resolve('שופרסל דיזנגוף');
      expect(result.success).toBe(true);
      expect((result as any).data.payeeName).toBe('Shufersal');
    });

    it('falls back to shorter match for non-specific text', () => {
      const result = resolver.resolve('סופר כל הטעמים');
      expect(result.success).toBe(true);
      expect((result as any).data.payeeName).toBe('Supermarket');
    });

    it('is case-insensitive for English descriptions', () => {
      const rules: ITranslationRule[] = [{ fromPayee: 'store', toPayee: 'General Store' }];
      const eng = new TranslateCategoryResolver(rules);
      const result = eng.resolve('STORE checkout');
      expect(result.success).toBe(true);
      expect((result as any).data).toEqual({
        payeeName: 'General Store',
        importedPayee: 'STORE checkout'
      });
    });

    it('handles empty translations array', () => {
      const empty = new TranslateCategoryResolver([]);
      const result = empty.resolve('שופרסל');
      expect(result.success).toBe(false);
    });

    it('handles empty description', () => {
      const result = resolver.resolve('');
      expect(result.success).toBe(false);
    });

    it('does not set categoryId (translate mode only sets payeeName)', () => {
      const result = resolver.resolve('רמי לוי תל אביב');
      expect(result.success).toBe(true);
      expect((result as any).data.categoryId).toBeUndefined();
      expect((result as any).data.payeeName).toBe('Rami Levy');
    });

    it('matches when fromPayee is at the start of description', () => {
      const result = resolver.resolve('סופר');
      expect(result.success).toBe(true);
      expect((result as any).data).toEqual({
        payeeName: 'Supermarket',
        importedPayee: 'סופר'
      });
    });
  });
});
