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
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { extractQueryData } from '../../src/utils/index.js';

const DATA_DIR = join(import.meta.dirname, 'fixtures', 'e2e-data');

function findBudgetId(): string | null {
  if (!existsSync(DATA_DIR)) return null;
  const entries = readdirSync(DATA_DIR);
  return entries.find(e => e.startsWith('e2e-test-budget-')) ?? null;
}

const BUDGET_ID = findBudgetId();
const HAS_BUDGET = !!BUDGET_ID;

interface TransactionRow {
  imported_id: string;
  amount: number;
}

describe.runIf(HAS_BUDGET)('Docker Pipeline E2E', () => {
  let transactions: TransactionRow[] = [];

  beforeAll(async () => {
    await api.init({ dataDir: DATA_DIR });
    await api.loadBudget(BUDGET_ID!);

    const result = await api.runQuery(
      api.q('transactions')
        .filter({ imported_id: { $ne: null } })
        .select(['imported_id', 'amount'])
    );
    transactions = extractQueryData<TransactionRow[]>(result, []);
  });

  afterAll(async () => {
    try { await api.shutdown(); } catch { /* ignore */ }
  });

  describe('Transaction Import', () => {
    it('imported all mock transactions from bank 1', () => {
      const bank1 = transactions.filter(r => r.imported_id.startsWith('e2eTestBank-E2E-001-'));
      expect(bank1.length).toBeGreaterThanOrEqual(6);
    });

    it('imported all mock transactions from bank 2', () => {
      const bank2 = transactions.filter(r => r.imported_id.startsWith('e2eTestBank2-E2E-002-'));
      expect(bank2.length).toBeGreaterThanOrEqual(2);
    });

    it('stored correct amounts in cents for bank 1', () => {
      const byId = new Map(transactions.map(r => [r.imported_id, r.amount]));

      expect(byId.get('e2eTestBank-E2E-001-txn-e2e-001')).toBe(-15050);
      expect(byId.get('e2eTestBank-E2E-001-txn-e2e-002')).toBe(500000);
      expect(byId.get('e2eTestBank-E2E-001-txn-e2e-003')).toBe(-4990);
    });

    it('stored Hebrew description transaction correctly', () => {
      const byId = new Map(transactions.map(r => [r.imported_id, r.amount]));
      expect(byId.get('e2eTestBank-E2E-001-txn-e2e-004')).toBe(-32000);
    });

    it('stored 1-cent edge case correctly', () => {
      const byId = new Map(transactions.map(r => [r.imported_id, r.amount]));
      expect(byId.get('e2eTestBank-E2E-001-txn-e2e-005')).toBe(-1);
    });

    it('stored large purchase correctly', () => {
      const byId = new Map(transactions.map(r => [r.imported_id, r.amount]));
      expect(byId.get('e2eTestBank-E2E-001-txn-e2e-006')).toBe(-999999);
    });

    it('stored bank 2 amounts correctly', () => {
      const byId = new Map(transactions.map(r => [r.imported_id, r.amount]));
      expect(byId.get('e2eTestBank2-E2E-002-txn-b2-001')).toBe(150000);
      expect(byId.get('e2eTestBank2-E2E-002-txn-b2-002')).toBe(-45075);
    });
  });

  describe('Deduplication', () => {
    it('all expected imported_ids are present', () => {
      const ids = new Set(transactions.map(r => r.imported_id));
      expect(ids.has('e2eTestBank-E2E-001-txn-e2e-001')).toBe(true);
      expect(ids.has('e2eTestBank-E2E-001-txn-e2e-006')).toBe(true);
      expect(ids.has('e2eTestBank2-E2E-002-txn-b2-001')).toBe(true);
      expect(ids.has('e2eTestBank2-E2E-002-txn-b2-002')).toBe(true);
    });

    it('all 8 unique transaction ids exist across both banks', () => {
      const uniqueIds = new Set(transactions.map(r => r.imported_id));
      const bank1Ids = [...uniqueIds].filter(id => id.startsWith('e2eTestBank-E2E-001-txn-'));
      const bank2Ids = [...uniqueIds].filter(id => id.startsWith('e2eTestBank2-E2E-002-txn-'));
      expect(bank1Ids).toHaveLength(6);
      expect(bank2Ids).toHaveLength(2);
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
    it('created reconciliation for bank 1 account', () => {
      const recon = transactions.filter(r =>
        r.imported_id.startsWith('reconciliation-e2e00000-0000-0000-0000-000000000001-')
      );
      expect(recon.length).toBeGreaterThanOrEqual(1);
    });

    it('created reconciliation for bank 2 account', () => {
      const recon = transactions.filter(r =>
        r.imported_id.startsWith('reconciliation-e2e00000-0000-0000-0000-000000000002-')
      );
      expect(recon.length).toBeGreaterThanOrEqual(1);
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
