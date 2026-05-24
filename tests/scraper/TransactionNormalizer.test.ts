import { describe, it, expect } from 'vitest';

import normalizeCreditCardSigns from '../../src/Scraper/TransactionNormalizer.js';
import { fakeBankTransaction } from '../helpers/factories.js';

/**
 * Tests for the credit-card sign normalizer.
 *
 * Background: @sergienko4/israeli-bank-scrapers 8.3.0 silently fails to
 * negate credit-card transaction amounts in its internal autoMapTransaction
 * pipeline (the `maybeNegateAmount` step at index.mjs:7528 only fires when
 * a `voidIndicators` field is present in the raw payload). For visaCal,
 * max, isracard, amex this leaves chargedAmount with the source convention
 * (purchases positive, refunds negative) — which is INVERTED relative to
 * Actual Budget's convention (purchases negative outflow, refunds positive
 * inflow). The normalizer multiplies both chargedAmount and originalAmount
 * by -1 for the four credit-card scrapers and leaves all other banks
 * untouched.
 */
describe('normalizeCreditCardSigns', () => {
  describe('credit-card scrapers — sign is flipped', () => {
    it.each(['visaCal', 'max', 'isracard', 'amex'])(
      '%s purchase: positive chargedAmount becomes negative outflow',
      (bankName) => {
        const txn = fakeBankTransaction({
          chargedAmount: 144,
          originalAmount: 144,
          description: 'Test Merchant',
          identifier: 'abc',
        });
        const [result] = normalizeCreditCardSigns(bankName, [txn]);
        expect(result.chargedAmount).toBe(-144);
        expect(result.originalAmount).toBe(-144);
      },
    );

    it.each(['visaCal', 'max', 'isracard', 'amex'])(
      '%s refund: negative chargedAmount becomes positive inflow',
      (bankName) => {
        const txn = fakeBankTransaction({
          chargedAmount: -50,
          originalAmount: -50,
          description: 'Refund — store credit',
          identifier: 'xyz',
        });
        const [result] = normalizeCreditCardSigns(bankName, [txn]);
        expect(result.chargedAmount).toBe(50);
        expect(result.originalAmount).toBe(50);
      },
    );

    it('treats bank name as case-insensitive (VISACAL / VisaCal / visacal)', () => {
      const txn = fakeBankTransaction({ chargedAmount: 28, originalAmount: 28 });
      for (const name of ['VISACAL', 'VisaCal', 'visacal']) {
        const [result] = normalizeCreditCardSigns(name, [txn]);
        expect(result.chargedAmount, `bankName=${name}`).toBe(-28);
      }
    });

    it('leaves zero amounts unchanged', () => {
      const txn = fakeBankTransaction({ chargedAmount: 0, originalAmount: 0 });
      const [result] = normalizeCreditCardSigns('visaCal', [txn]);
      expect(result.chargedAmount).toBe(0);
      expect(result.originalAmount).toBe(0);
    });

    it('leaves undefined amounts unchanged', () => {
      const txn: ReturnType<typeof fakeBankTransaction> = {
        date: '2026-05-19',
        description: 'No amount data',
      };
      const [result] = normalizeCreditCardSigns('amex', [txn]);
      expect(result.chargedAmount).toBeUndefined();
      expect(result.originalAmount).toBeUndefined();
    });

    it('preserves all other fields verbatim (date, description, identifier, memo)', () => {
      const txn = fakeBankTransaction({
        date: '2026-05-19',
        description: 'Sandro Pizza',
        identifier: 'txn-abc-123',
        memo: 'A note',
        chargedAmount: 35,
        originalAmount: 35,
      });
      const [result] = normalizeCreditCardSigns('visaCal', [txn]);
      expect(result.date).toBe('2026-05-19');
      expect(result.description).toBe('Sandro Pizza');
      expect(result.identifier).toBe('txn-abc-123');
      expect(result.memo).toBe('A note');
    });
  });

  describe('non-credit-card scrapers — sign is preserved', () => {
    it.each(['hapoalim', 'leumi', 'discount', 'beinleumi', 'mizrahi', 'oneZero'])(
      '%s amounts pass through untouched',
      (bankName) => {
        const debitTxn = fakeBankTransaction({ chargedAmount: -150, originalAmount: -150 });
        const creditTxn = fakeBankTransaction({ chargedAmount: 500, originalAmount: 500 });
        const [debit, credit] = normalizeCreditCardSigns(bankName, [debitTxn, creditTxn]);
        expect(debit.chargedAmount).toBe(-150);
        expect(debit.originalAmount).toBe(-150);
        expect(credit.chargedAmount).toBe(500);
        expect(credit.originalAmount).toBe(500);
      },
    );
  });

  describe('purity', () => {
    it('does not mutate the input array or its elements', () => {
      const txn = fakeBankTransaction({ chargedAmount: 144, originalAmount: 144 });
      const input = [txn];
      const inputSnapshot = JSON.parse(JSON.stringify(input)) as typeof input;
      normalizeCreditCardSigns('visaCal', input);
      expect(JSON.parse(JSON.stringify(input))).toEqual(inputSnapshot);
    });
  });

  describe('empty input', () => {
    it('returns empty array for empty input regardless of bank', () => {
      expect(normalizeCreditCardSigns('visaCal', [])).toEqual([]);
      expect(normalizeCreditCardSigns('hapoalim', [])).toEqual([]);
    });
  });
});
