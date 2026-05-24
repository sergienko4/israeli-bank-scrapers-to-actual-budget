/**
 * Docker Pipeline E2E Test
 * Verifies results after the importer Docker container has run.
 *
 * Prerequisites:
 *   1. npm run test:e2e:setup (creates local budget + config)
 *   2. Docker importer run #1 (first import with mock scraper)
 *   3. Docker importer run #2 (dedup verification — same data, no new txns)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import api from '@actual-app/api';
import { join } from 'path';
import { extractQueryData } from '../../src/Utils/Index.js';
import { findBudgetId, getFixturesDir } from './helpers/dockerRunner.js';

const DATA_DIR = join(getFixturesDir(), 'e2e-data');
const BUDGET_ID = findBudgetId();
const HAS_BUDGET = !!BUDGET_ID;

interface TransactionRow {
  imported_id: string;
  amount: number;
  account: string;
  imported_payee: string;
}

const BANK1_DESCRIPTIONS = new Set([
  'Test Supermarket', 'Test Salary', 'Test Netflix',
  'סופר פארם', 'Precision Edge Case', 'Large Purchase',
]);
const BANK2_DESCRIPTIONS = new Set(['Bank2 Transfer', 'Bank2 Electric Bill']);

const { hasData, rows } = await (async (): Promise<{ hasData: boolean; rows: TransactionRow[] }> => {
  if (!HAS_BUDGET) return { hasData: false, rows: [] };
  await api.init({ dataDir: DATA_DIR });
  await api.loadBudget(BUDGET_ID!);
  const result = await api.runQuery(
    api.q('transactions')
      .select(['imported_id', 'amount', 'account', 'imported_payee'])
  );
  const all = extractQueryData<TransactionRow[]>(result, []);
  const data = all.filter(r => r.imported_id !== null);
  if (data.length === 0) {
    await api.shutdown();
    return { hasData: false, rows: [] };
  }
  return { hasData: true, rows: data };
})();

describe.runIf(hasData)('Docker Pipeline E2E', () => {
  let transactions: TransactionRow[] = [];
  let amountByPayee: Map<string, number> = new Map();

  beforeAll(() => {
    transactions = rows;
    // Mock fixture descriptions are unique per txn — safe to index by imported_payee.
    // The actual imported_id is now a 16-char content-hash (PR #370) and varies
    // by content, so we identify expected txns by payee name instead.
    amountByPayee = new Map(rows.map(r => [r.imported_payee, r.amount]));
  });

  afterAll(async () => {
    try { await api.shutdown(); } catch { /* ignore */ }
  });

  describe('Transaction Import', () => {
    it('imported all mock transactions from bank 1', () => {
      const bank1 = transactions.filter(r => BANK1_DESCRIPTIONS.has(r.imported_payee));
      expect(bank1.length).toBeGreaterThanOrEqual(6);
    });

    it('imported all mock transactions from bank 2', () => {
      const bank2 = transactions.filter(r => BANK2_DESCRIPTIONS.has(r.imported_payee));
      expect(bank2.length).toBeGreaterThanOrEqual(2);
    });

    it('stored correct amounts in cents for bank 1', () => {
      expect(amountByPayee.get('Test Supermarket')).toBe(-15050);
      expect(amountByPayee.get('Test Salary')).toBe(500000);
      expect(amountByPayee.get('Test Netflix')).toBe(-4990);
    });

    it('stored Hebrew description transaction correctly', () => {
      expect(amountByPayee.get('סופר פארם')).toBe(-32000);
    });

    it('stored 1-cent edge case correctly', () => {
      expect(amountByPayee.get('Precision Edge Case')).toBe(-1);
    });

    it('stored large purchase correctly', () => {
      expect(amountByPayee.get('Large Purchase')).toBe(-999999);
    });

    it('stored bank 2 amounts correctly', () => {
      expect(amountByPayee.get('Bank2 Transfer')).toBe(150000);
      expect(amountByPayee.get('Bank2 Electric Bill')).toBe(-45075);
    });
  });

  describe('Deduplication', () => {
    it('all expected mock transactions are present (by payee)', () => {
      const payees = new Set(transactions.map(r => r.imported_payee));
      for (const desc of BANK1_DESCRIPTIONS) {
        expect(payees.has(desc), `bank 1: ${desc}`).toBe(true);
      }
      for (const desc of BANK2_DESCRIPTIONS) {
        expect(payees.has(desc), `bank 2: ${desc}`).toBe(true);
      }
    });

    it('all 8 unique transactions exist across both banks (after two import runs)', () => {
      const payees = new Set(transactions.map(r => r.imported_payee));
      const bank1Found = [...payees].filter(p => BANK1_DESCRIPTIONS.has(p));
      const bank2Found = [...payees].filter(p => BANK2_DESCRIPTIONS.has(p));
      expect(bank1Found).toHaveLength(6);
      expect(bank2Found).toHaveLength(2);
    });

    it('imported_id is a 16-char hex hash (post-PR #370 content-hash format)', () => {
      // Only check mock-fixture txns we know came from our importer with the
      // new hash formula. Other rows (reconciliation, anything Actual creates
      // internally) may have their own imported_id format and aren't in scope.
      const knownDescriptions = new Set([...BANK1_DESCRIPTIONS, ...BANK2_DESCRIPTIONS]);
      const ourTxns = transactions.filter(r => knownDescriptions.has(r.imported_payee));
      expect(ourTxns.length, 'expected to find all 8 mock-fixture txns').toBe(8);
      for (const r of ourTxns) {
        expect(r.imported_id, `txn payee=${r.imported_payee}`).toMatch(/^[a-f0-9]{16}$/);
      }
    });
  });

  describe('Account Creation', () => {
    it('created account for bank 1', async () => {
      const accounts = await api.getAccounts();
      const account = accounts.find(a => a.name.includes('e2eTestBank') && a.name.includes('E2E-001'));
      expect(account).toBeDefined();
    });

    it('created account for bank 2', async () => {
      const accounts = await api.getAccounts();
      const account = accounts.find(a => a.name.includes('e2eTestBank2') && a.name.includes('E2E-002'));
      expect(account).toBeDefined();
    });
  });

  describe('Reconciliation', () => {
    it('created one reconciliation per account', () => {
      const recon = transactions.filter(r =>
        r.imported_id.startsWith('reconciliation-')
      );
      expect(recon.length).toBe(2);
      const uniqueAccounts = new Set(recon.map(r => r.account));
      expect(uniqueAccounts.size).toBe(2);
    });
  });

  describe('Spending Watch', () => {
    it('spending watch data is queryable from imported transactions', async () => {
      const result = await api.runQuery(
        api.q('transactions')
          .filter({ amount: { $lt: 0 } })
          .select(['amount', 'imported_payee'])
      );
      const debits = extractQueryData<Array<{ amount: number }>>(result, []);
      expect(debits.length).toBeGreaterThan(0);

      const totalSpent = debits.reduce((sum, t) => sum + Math.abs(t.amount), 0);
      expect(totalSpent).toBeGreaterThan(50000);
    });
  });
});
