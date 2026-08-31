/**
 * Debit-sign upgrade regression tests for scraper 8.6.10.
 *
 * Hapoalim sends `eventAmount` as an unsigned magnitude and carries the
 * direction in the numeric `eventActivityTypeCode` (1 = inbound,
 * 2 = outbound). Up to and including scraper 8.6.9 the upstream sign stage
 * only read worded direction fields, so every outbound row mapped POSITIVE
 * and a charge was booked as income. Upstream PR #536 (shipped in 8.6.10)
 * reads the direction code, so outbound rows now arrive NEGATIVE.
 *
 * Hapoalim carries `signPolicy: 'preserve'`, meaning this importer forwards
 * the upstream sign verbatim. These tests pin the properties that make that
 * pass-through safe:
 *
 * SCOPE — these tests exercise THIS importer, not the upstream fix. The
 * scraper's mapper is not reachable across the package boundary (`lib/
 * index.d.ts` exports the scraper API, not its sign stage), so a raw
 * `eventActivityTypeCode` row cannot be driven from here and these tests
 * would also pass against a scraper predating the fix. They guard the half
 * we own: that a signed row survives our pipeline unaltered, and what that
 * sign means for row identity. Upstream owns proving the code is read, and
 * does so in its own suite.
 *
 *   1. Hapoalim stays on `preserve` — re-introducing a flip would negate an
 *      already-negative charge and book every debit as income again.
 *   2. An outbound charge reaches Actual Budget as an OUTFLOW (negative).
 *   3. Hapoalim is not a card issuer, so the one-off `--cleanup-card-refunds`
 *      command cannot reach its accounts. That matters because the stale-row
 *      matcher assumes the WRONG row is the negative one, which is inverted
 *      for this defect: here the stale row is the POSITIVE one.
 *
 * One test pins the known operational consequence rather than a
 * desired one: `imported_id` hashes the signed amount, so the 8.6.9 to
 * 8.6.10 correction necessarily yields a different id. A re-scrape of an
 * overlapping window therefore writes the corrected row as a NEW row while
 * the wrong-signed one remains. That is inherent to correcting a sign under
 * content-hash dedup and is documented here so a future reader does not
 * mistake it for an unnoticed defect.
 */

import { describe, it, expect } from 'vitest';

import { createBankRegistry } from '../../src/Scraper/BankRegistry.js';
import createScrapeResultMapper from '../../src/Scraper/Mappers/DefaultScrapeResultMapper.js';
import { buildImportedId, parseTransaction } from '../../src/Services/Transaction/ImportedIdBuilder.js';
import { CREDIT_CARD_BANKS } from '../../src/Types/BankCatalog.js';
import type { IBankTransaction, IRawScrape, ISignPolicy } from '../../src/Types/Index.js';

const mapper = createScrapeResultMapper();
const startDate = new Date('2026-01-01');
const endDate = new Date('2026-01-31');

/**
 * Reads a bank's sign policy from the shared catalog.
 *
 * Resolved rather than passed in, so that changing the catalog entry breaks
 * these tests instead of silently bypassing them.
 *
 * @param bankId - Bank id to look up.
 * @returns The bank's configured sign policy.
 */
function policyFor(bankId: string): ISignPolicy {
  const result = createBankRegistry().resolve(bankId);
  if (!result.success) throw new Error(`Unknown bank in catalog: ${bankId}`);
  return result.data.signPolicy;
}

/**
 * Runs one transaction through the canonical scrape mapper.
 * @param bankId - Bank id to embed in the raw envelope.
 * @param txn - Single provider transaction to map.
 * @returns The mapped transaction as the importer would see it.
 */
function mapOne(bankId: string, txn: IBankTransaction): IBankTransaction {
  const account = { accountNumber: '9', balance: 0, txns: [txn] };
  const raw: IRawScrape = {
    bankId, attemptCount: 1, strategy: 'live',
    raw: { success: true, accounts: [account] as IRawScrape['raw']['accounts'] },
  };
  const signPolicy = policyFor(bankId);
  return mapper.mapToCanonical({ raw, signPolicy, startDate, endDate }).accounts[0].txns[0];
}

/**
 * Computes the `imported_id` the importer would write for a mapped txn.
 *
 * Mirrors the production account key built in TransactionBatchImporter.
 *
 * @param bankId - Bank the transaction belongs to; seeds the account key.
 * @param txn - Mapped transaction to hash.
 * @returns The 16-char content hash.
 */
function idFor(bankId: string, txn: IBankTransaction): string {
  return buildImportedId(`${bankId}-9`, txn, parseTransaction(txn));
}

describe('hapoalim sign policy after scraper 8.6.10', () => {
  it('keeps hapoalim on the preserve policy', () => {
    const result = createBankRegistry().resolve('hapoalim');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.signPolicy).toBe('preserve');
  });

  it('records an outbound charge as an outflow', () => {
    const scraped: IBankTransaction = {
      date: '2026-01-15', description: 'SUPERMARKET', chargedAmount: -122.17, originalAmount: -122.17,
    };
    expect(mapOne('hapoalim', scraped).chargedAmount).toBe(-122.17);
  });

  it('records an inbound salary as an inflow', () => {
    const scraped: IBankTransaction = {
      date: '2026-01-01', description: 'SALARY', chargedAmount: 9000, originalAmount: 9000,
    };
    expect(mapOne('hapoalim', scraped).chargedAmount).toBe(9000);
  });

  it('excludes hapoalim from the card-refund cleanup blast radius', () => {
    expect(CREDIT_CARD_BANKS.has('hapoalim')).toBe(false);
  });
});

/**
 * The inbound salary row exactly as the importer mapped it before 8.6.10,
 * written out as literals rather than recomputed.
 *
 * 8.6.10 only taught the sign stage to read `eventActivityTypeCode`, which an
 * inbound row does not carry, so this row must survive the upgrade untouched.
 * Deriving the expectation from the current mapper would assert `f(x) = f(x)`
 * and pass no matter how the mapper changed; pinning it means a regression on
 * the inbound path has to move these constants to stay green.
 */
const INBOUND_BASELINE_ROW: IBankTransaction = {
  date: '2026-01-01', description: 'SALARY', chargedAmount: 9000, originalAmount: 9000,
};

/** The `imported_id` that baseline row has always hashed to. */
const INBOUND_BASELINE_ID = 'f04b0acee5c3b748';

describe('imported_id impact of the 8.6.9 to 8.6.10 direction fix', () => {
  it('changes the hash when an outbound charge gains its sign', () => {
    const before = mapOne('hapoalim', {
      date: '2026-01-15', description: 'SUPERMARKET', chargedAmount: 122.17, originalAmount: 122.17,
    });
    const after = mapOne('hapoalim', {
      date: '2026-01-15', description: 'SUPERMARKET', chargedAmount: -122.17, originalAmount: -122.17,
    });
    expect(before.chargedAmount).toBe(122.17);
    expect(after.chargedAmount).toBe(-122.17);
    expect(idFor('hapoalim', after)).not.toBe(idFor('hapoalim', before));
  });

  it('leaves an inbound row and its id identical to the pre-8.6.10 baseline', () => {
    const mapped = mapOne('hapoalim', INBOUND_BASELINE_ROW);

    expect(mapped).toEqual(INBOUND_BASELINE_ROW);
    expect(idFor('hapoalim', mapped)).toBe(INBOUND_BASELINE_ID);
  });
});
