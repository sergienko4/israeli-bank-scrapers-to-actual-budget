/**
 * Realistic end-to-end import flow validation.
 *
 * Simulates the upstream `@sergienko4/israeli-bank-scrapers` output shape
 * for the four credit-card scrapers (visaCal, max, isracard, amex) and
 * the canonical bank scraper (hapoalim) with realistic transaction
 * counts and field layouts (matching `autoMapTransaction` at
 * upstream's index.mjs:7582-7592).
 *
 * Runs the full BankScraper → TransactionService pipeline N times with
 * the same logical transactions but FRESH randomized `identifier`
 * values each run (simulating Bug 1: upstream identifier drift).
 *
 * Asserts:
 *   1. Run 1: every input transaction is inserted (new = N)
 *   2. Run 2+: every input transaction is recognized as a duplicate
 *      regardless of identifier drift (new = 0)
 *   3. Credit-card amounts are negated by the scraper-boundary
 *      normalizer (Bug 2): positive scraper input → negative Actual
 *      payload amount
 *   4. Non-credit-card amounts pass through unchanged
 *   5. Refunds (negative scraper input) flip to positive Actual
 *      payload amount for credit-card scrapers
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import normalizeCreditCardSigns from '../../src/Scraper/TransactionNormalizer.js';
import { TransactionService } from '../../src/Services/TransactionService.js';
import type { IBankTransaction } from '../../src/Types/Index.js';

vi.mock('../../src/Logger/Index.js', () => ({
  getLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  getLogBuffer: vi.fn(),
  createLogger: vi.fn(),
}));

/** Upstream's ITransaction-like shape — what autoMapTransaction returns. */
interface IUpstreamTxn extends IBankTransaction {
  type: 'normal' | 'installments';
  processedDate: string;
  originalCurrency: string;
  status: 'completed' | 'pending';
}

let identifierCounter = 0;
function freshIdentifier(): string {
  identifierCounter += 1;
  return `scrape-${String(Date.now())}-row-${String(identifierCounter)}`;
}

interface ISeedTxn {
  date: string;
  chargedAmount: number;
  originalAmount: number;
  description: string;
}

/**
 * Builds an upstream-shape transaction from seed (date/amount/desc) with
 * a FRESH random identifier — mimics the upstream returning a different
 * identifier on each scrape for the same real-world transaction.
 * @param seed - The stable content fields of the txn.
 * @returns A txn with upstream's full shape and a fresh identifier.
 */
function buildUpstreamTxn(seed: ISeedTxn): IUpstreamTxn {
  return {
    type: 'normal',
    date: seed.date,
    processedDate: seed.date,
    originalAmount: seed.originalAmount,
    originalCurrency: 'ILS',
    chargedAmount: seed.chargedAmount,
    description: seed.description,
    status: 'completed',
    identifier: freshIdentifier(),
  };
}

/** Realistic visaCal-style fixture: positive amounts (purchases) + one negative (refund). */
const VISACAL_SEEDS: ISeedTxn[] = [
  { date: '2026-05-19', chargedAmount: 144, originalAmount: 144, description: 'Bitbox Hadrei Kriyut' },
  { date: '2026-05-19', chargedAmount: 35, originalAmount: 35, description: 'Bitbox Hadrei Kriyut #2' },
  { date: '2026-05-17', chargedAmount: 28, originalAmount: 28, description: 'Sandro Pizza' },
  { date: '2026-05-14', chargedAmount: 53, originalAmount: 53, description: 'Sandro Pizza #2' },
  { date: '2026-05-14', chargedAmount: 35, originalAmount: 35, description: 'Cinetro' },
  { date: '2026-05-10', chargedAmount: -50, originalAmount: -50, description: 'Refund — store credit' },
];

/** Realistic max-style fixture: same convention as visaCal. */
const MAX_SEEDS: ISeedTxn[] = [
  { date: '2026-05-20', chargedAmount: 230, originalAmount: 230, description: 'Shufersal Deal' },
  { date: '2026-05-18', chargedAmount: 99, originalAmount: 99, description: 'Aroma Espresso' },
];

/** Realistic isracard-style fixture: same convention. */
const ISRACARD_SEEDS: ISeedTxn[] = [
  { date: '2026-05-21', chargedAmount: 450, originalAmount: 450, description: 'Online subscription' },
  { date: '2026-05-15', chargedAmount: -120, originalAmount: -120, description: 'Refund — subscription cancel' },
];

/** Realistic amex-style fixture: same convention. */
const AMEX_SEEDS: ISeedTxn[] = [
  { date: '2026-05-22', chargedAmount: 1200, originalAmount: 1200, description: 'Flight booking' },
];

/** Realistic hapoalim-style fixture: NORMAL signs (debits negative, credits positive). */
const HAPOALIM_SEEDS: ISeedTxn[] = [
  { date: '2026-05-19', chargedAmount: -150.5, originalAmount: -150.5, description: 'Test Supermarket' },
  { date: '2026-05-18', chargedAmount: 5000, originalAmount: 5000, description: 'Test Salary' },
  { date: '2026-05-15', chargedAmount: -49.9, originalAmount: -49.9, description: 'Test Netflix' },
];

/**
 * Creates a mock @actual-app/api that tracks all importTransactions
 * payloads and exposes their imported_ids back through aqlQuery on
 * subsequent calls (simulating Actual Budget's storage).
 */
function buildMockActualApi(): {
  mock: any;
  insertedPayloads: Array<{ imported_id: string; amount: number; payee_name: string; date: string }>;
} {
  const storedImportedIds = new Set<string>();
  const insertedPayloads: Array<{ imported_id: string; amount: number; payee_name: string; date: string }> = [];

  const mock = {
    importTransactions: vi.fn(async (_accountId: string, payload: Array<{ imported_id: string; amount: number; payee_name: string; date: string }>) => {
      for (const p of payload) {
        if (storedImportedIds.has(p.imported_id)) {
          throw new Error('Transaction already exists');
        }
        storedImportedIds.add(p.imported_id);
        insertedPayloads.push(p);
      }
      return undefined;
    }),
    aqlQuery: vi.fn(async () => ({
      data: Array.from(storedImportedIds).map((id) => ({ imported_id: id })),
    })),
    q: vi.fn(() => ({ filter: vi.fn(() => ({ select: vi.fn() })) })),
    getAccounts: vi.fn(),
    createAccount: vi.fn(),
  };
  return { mock, insertedPayloads };
}

/**
 * Runs the full scrape-then-import pipeline once for a given bank.
 * Mimics what AccountImporter does per-account but inlined for clarity.
 */
async function runOneImport(
  bankName: string,
  seeds: ISeedTxn[],
  service: TransactionService,
  accountNumber: string,
): Promise<{ imported: number; skipped: number }> {
  const rawTxns = seeds.map(buildUpstreamTxn);
  // Mirror BankScraper.normalizeSigns: apply normalizer at the boundary.
  const normalizedTxns = normalizeCreditCardSigns(bankName, rawTxns);
  const result = await service.importTransactions({
    bankName, accountNumber, actualAccountId: 'acc-uuid',
    transactions: normalizedTxns,
  });
  if (!result.success) throw new Error('importTransactions failed');
  return { imported: result.data.imported, skipped: result.data.skipped };
}

describe('Realistic import flow (multi-run validation)', () => {
  let mockApi: ReturnType<typeof buildMockActualApi>['mock'];
  let inserted: ReturnType<typeof buildMockActualApi>['insertedPayloads'];
  let service: TransactionService;

  beforeEach(() => {
    identifierCounter = 0;
    const built = buildMockActualApi();
    mockApi = built.mock;
    inserted = built.insertedPayloads;
    service = new TransactionService(mockApi);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Bug 2 — credit-card sign normalization', () => {
    it.each([
      ['visaCal', VISACAL_SEEDS, '3308'],
      ['max', MAX_SEEDS, '1234'],
      ['isracard', ISRACARD_SEEDS, '5678'],
      ['amex', AMEX_SEEDS, '9012'],
    ])(
      '%s: positive scraper input → negative Actual payload (outflow); negative → positive (inflow)',
      async (bankName, seeds, accountNumber) => {
        await runOneImport(bankName, seeds, service, accountNumber);
        for (let i = 0; i < seeds.length; i++) {
          const expected = -seeds[i].chargedAmount * 100;
          expect(inserted[i].amount, `${bankName} txn ${String(i)} (${seeds[i].description})`).toBe(expected);
        }
      },
    );

    it('hapoalim (non-card): amounts pass through unchanged', async () => {
      await runOneImport('hapoalim', HAPOALIM_SEEDS, service, 'h-1234');
      for (let i = 0; i < HAPOALIM_SEEDS.length; i++) {
        const expected = HAPOALIM_SEEDS[i].chargedAmount * 100;
        expect(inserted[i].amount).toBe(expected);
      }
    });
  });

  describe('Bug 1 — dedup despite identifier drift (multi-run)', () => {
    it.each([
      ['visaCal', VISACAL_SEEDS, '3308'],
      ['max', MAX_SEEDS, '1234'],
      ['isracard', ISRACARD_SEEDS, '5678'],
      ['amex', AMEX_SEEDS, '9012'],
      ['hapoalim', HAPOALIM_SEEDS, 'h-1234'],
    ])(
      '%s: 3 runs with fresh identifiers each → only first run inserts',
      async (bankName, seeds, accountNumber) => {
        const run1 = await runOneImport(bankName, seeds, service, accountNumber);
        expect(run1.imported, `${bankName} run 1 imported`).toBe(seeds.length);
        expect(run1.skipped, `${bankName} run 1 skipped`).toBe(0);

        const run2 = await runOneImport(bankName, seeds, service, accountNumber);
        expect(run2.imported, `${bankName} run 2 imported`).toBe(0);
        expect(run2.skipped, `${bankName} run 2 skipped`).toBe(seeds.length);

        const run3 = await runOneImport(bankName, seeds, service, accountNumber);
        expect(run3.imported, `${bankName} run 3 imported`).toBe(0);
        expect(run3.skipped, `${bankName} run 3 skipped`).toBe(seeds.length);

        expect(inserted.length, `${bankName}: total inserted across 3 runs`).toBe(seeds.length);
      },
    );

    it('all 4 credit-card banks + hapoalim in sequence: 0 cross-bank collisions', async () => {
      await runOneImport('visaCal', VISACAL_SEEDS, service, '3308');
      await runOneImport('max', MAX_SEEDS, service, '1234');
      await runOneImport('isracard', ISRACARD_SEEDS, service, '5678');
      await runOneImport('amex', AMEX_SEEDS, service, '9012');
      await runOneImport('hapoalim', HAPOALIM_SEEDS, service, 'h-1234');
      const expectedTotal =
        VISACAL_SEEDS.length + MAX_SEEDS.length + ISRACARD_SEEDS.length +
        AMEX_SEEDS.length + HAPOALIM_SEEDS.length;
      expect(inserted.length).toBe(expectedTotal);
    });

    it('5 consecutive runs of all banks: still exactly the unique transaction count', async () => {
      for (let i = 0; i < 5; i++) {
        await runOneImport('visaCal', VISACAL_SEEDS, service, '3308');
        await runOneImport('max', MAX_SEEDS, service, '1234');
        await runOneImport('isracard', ISRACARD_SEEDS, service, '5678');
        await runOneImport('amex', AMEX_SEEDS, service, '9012');
        await runOneImport('hapoalim', HAPOALIM_SEEDS, service, 'h-1234');
      }
      const expectedTotal =
        VISACAL_SEEDS.length + MAX_SEEDS.length + ISRACARD_SEEDS.length +
        AMEX_SEEDS.length + HAPOALIM_SEEDS.length;
      expect(inserted.length, '5 runs × 5 banks should still be the unique txn count').toBe(expectedTotal);
    });
  });

  describe('Bug 1 + Bug 2 combined: payload integrity across runs', () => {
    it('visaCal: all payload signs and dedup are correct across 5 runs', async () => {
      for (let i = 0; i < 5; i++) {
        await runOneImport('visaCal', VISACAL_SEEDS, service, '3308');
      }
      expect(inserted.length).toBe(VISACAL_SEEDS.length);
      const purchases = inserted.filter((p) => p.amount < 0);
      const refunds = inserted.filter((p) => p.amount > 0);
      expect(purchases.length).toBe(5);
      expect(refunds.length).toBe(1);
      // Every inserted imported_id must be a 16-char hex string (hash format)
      for (const p of inserted) {
        expect(p.imported_id).toMatch(/^[a-f0-9]{16}$/);
      }
    });
  });
});
