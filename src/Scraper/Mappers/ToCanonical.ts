/**
 * Forward mapper — converts a raw provider scrape envelope into the
 * canonical ICanonicalScrapeResult shape consumed by phase-3 importers.
 */

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';

import type {
  IBankTransaction, ICanonicalAccount, ICanonicalScrapeResult,
} from '../../Types/Index.js';
import { formatDate } from '../../Utils/Index.js';
import type { IMapToCanonicalOpts } from './IScrapeResultMapper.js';
import applySignPolicy from './Sign.js';

type ProviderAccount = NonNullable<IScraperScrapingResult['accounts']>[number];

/**
 * Maps a single provider account record into a canonical account.
 * @param account - Provider account record.
 * @param opts - Surrounding mapper opts providing sign policy + bankId.
 * @returns ICanonicalAccount with sign-normalized transactions.
 */
function mapAccount(
  account: ProviderAccount, opts: IMapToCanonicalOpts,
): ICanonicalAccount {
  const hasTxns = Array.isArray(account.txns);
  const accountTxns = hasTxns
    ? (account.txns as readonly IBankTransaction[])
    : ([] as readonly IBankTransaction[]);
  const txns = applySignPolicy(accountTxns, opts);
  return {
    accountNumber: account.accountNumber,
    balance: account.balance ?? null,
    txns,
  };
}

/**
 * Builds the canonical metadata block for a forward-mapped scrape.
 * @param opts - Raw scrape + sign policy + window dates.
 * @returns Frozen canonical metadata.
 */
function buildMetadata(opts: IMapToCanonicalOpts): ICanonicalScrapeResult['metadata'] {
  return {
    startDate: formatDate(opts.startDate),
    endDate: formatDate(opts.endDate),
    signPolicyApplied: opts.signPolicy,
    strategy: opts.raw.strategy,
    attemptCount: opts.raw.attemptCount,
  };
}

/**
 * Maps a raw provider scrape into a canonical scrape result.
 * @param opts - Raw scrape, sign policy, and scrape window dates.
 * @returns ICanonicalScrapeResult with normalized accounts + metadata.
 */
export default function mapToCanonical(opts: IMapToCanonicalOpts): ICanonicalScrapeResult {
  const rawAccounts = opts.raw.raw.success && opts.raw.raw.accounts
    ? opts.raw.raw.accounts : [];
  const accounts = rawAccounts.map(account => mapAccount(account, opts));
  return {
    bankId: opts.raw.bankId,
    scrapedAt: new Date().toISOString(),
    accounts,
    metadata: buildMetadata(opts),
  };
}
