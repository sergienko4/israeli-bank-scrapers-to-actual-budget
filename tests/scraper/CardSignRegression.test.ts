/**
 * Card-sign upgrade regression tests for scraper 8.6.7.
 *
 * Scraper 8.6.6 emitted credit-card charges as POSITIVE amounts and this
 * importer flipped them via `signPolicy: 'flip-credit'`. Upstream PR #483
 * (shipped in 8.6.7) negates card amounts at the source, so every bank now
 * carries `signPolicy: 'preserve'`. These tests pin the two properties that
 * make that swap safe:
 *
 *   1. A card charge still reaches Actual Budget as an OUTFLOW (negative).
 *   2. The resulting `imported_id` is byte-identical to the 8.6.6 pipeline,
 *      so the upgrade does not re-import history as duplicates.
 *
 * Property 2 is the expensive one to get wrong: `imported_id` hashes the
 * amount, so any net sign change silently duplicates every card row.
 */

import { describe, it, expect } from 'vitest';

import { createBankRegistry } from '../../src/Scraper/BankRegistry.js';
import createScrapeResultMapper from '../../src/Scraper/Mappers/DefaultScrapeResultMapper.js';
import { buildImportedId, parseTransaction } from '../../src/Services/Transaction/ImportedIdBuilder.js';
import { CREDIT_CARD_BANKS } from '../../src/Types/BankCatalog.js';
import type { IBankTransaction, IRawScrape, ISignPolicy } from '../../src/Types/Index.js';

const CARD_BANKS = [...CREDIT_CARD_BANKS];
const mapper = createScrapeResultMapper();
const startDate = new Date('2026-01-01');
const endDate = new Date('2026-01-31');

/**
 * Runs one transaction through the canonical scrape mapper.
 * @param bankId - Bank id to embed in the raw envelope.
 * @param signPolicy - Policy the mapper should apply.
 * @param txn - Single provider transaction to map.
 * @returns The mapped transaction as the importer would see it.
 */
function mapOne(bankId: string, signPolicy: ISignPolicy, txn: IBankTransaction): IBankTransaction {
  const account = { accountNumber: '9', balance: 0, txns: [txn] };
  const raw: IRawScrape = {
    bankId, attemptCount: 1, strategy: 'live',
    raw: { success: true, accounts: [account] as IRawScrape['raw']['accounts'] },
  };
  return mapper.mapToCanonical({ raw, signPolicy, startDate, endDate }).accounts[0].txns[0];
}

/**
 * Computes the `imported_id` the importer would write for a mapped txn.
 * @param txn - Mapped transaction to hash.
 * @returns The 16-char content hash.
 */
function idFor(txn: IBankTransaction): string {
  return buildImportedId('visacal|9', txn, parseTransaction(txn));
}

describe('card sign policy after scraper 8.6.7', () => {
  it('derives the card-bank matrix from the catalog', () => {
    expect([...CARD_BANKS].sort()).toEqual(['amex', 'isracard', 'max', 'visacal']);
  });

  it.each(CARD_BANKS)('registry gives %s the preserve policy', (bankId) => {
    const result = createBankRegistry().resolve(bankId);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.signPolicy).toBe('preserve');
  });

  it.each(CARD_BANKS)('records a %s purchase as an outflow', (bankId) => {
    const scraped: IBankTransaction = {
      date: '2026-01-15', description: 'SUPERMARKET', chargedAmount: -122.17, originalAmount: -122.17,
    };
    expect(mapOne(bankId, 'preserve', scraped).chargedAmount).toBe(-122.17);
  });

  it.each(CARD_BANKS)('records a %s refund as an inflow', (bankId) => {
    const scraped: IBankTransaction = {
      date: '2026-01-20', description: 'RETURN', chargedAmount: 50, originalAmount: 50,
    };
    expect(mapOne(bankId, 'preserve', scraped).chargedAmount).toBe(50);
  });
});

describe('imported_id stability across the 8.6.6 to 8.6.7 upgrade', () => {
  it('keeps the same hash for a card purchase', () => {
    const before = mapOne('visacal', 'flip-credit', {
      date: '2026-01-15', description: 'SUPERMARKET', chargedAmount: 122.17, originalAmount: 122.17,
    });
    const after = mapOne('visacal', 'preserve', {
      date: '2026-01-15', description: 'SUPERMARKET', chargedAmount: -122.17, originalAmount: -122.17,
    });
    expect(after.chargedAmount).toBe(before.chargedAmount);
    expect(idFor(after)).toBe(idFor(before));
  });

  it('keeps the same hash for a fully-signed refund', () => {
    const before = mapOne('isracard', 'flip-credit', {
      date: '2026-01-20', description: 'RETURN', chargedAmount: -50, originalAmount: -50,
    });
    const after = mapOne('isracard', 'preserve', {
      date: '2026-01-20', description: 'RETURN', chargedAmount: 50, originalAmount: 50,
    });
    expect(after.chargedAmount).toBe(before.chargedAmount);
    expect(idFor(after)).toBe(idFor(before));
  });

  it('changes the hash for a partially-signed VisaCal refund', () => {
    const before = mapOne('visacal', 'flip-credit', {
      date: '2026-01-20', description: 'RETURN', chargedAmount: 50, originalAmount: 50,
    });
    const after = mapOne('visacal', 'preserve', {
      date: '2026-01-20', description: 'RETURN', chargedAmount: 50, originalAmount: 50,
    });
    expect(before.chargedAmount).toBe(-50);
    expect(after.chargedAmount).toBe(50);
    expect(idFor(after)).not.toBe(idFor(before));
  });
});
