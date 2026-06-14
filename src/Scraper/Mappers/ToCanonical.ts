/**
 * Forward mapper — converts a raw provider scrape envelope into the
 * canonical ICanonicalScrapeResult shape consumed by phase-3 importers.
 */

import type {
  IBankTransaction, ICanonicalAccount, ICanonicalScrapeResult,
} from '../../Types/Index.js';
import { formatDate } from '../../Utils/Index.js';
import type { IMapToCanonicalOpts } from './IScrapeResultMapper.js';
import applySignPolicy from './Sign.js';
import type { ProviderAccount } from './Types.js';

/**
 * Extracts a frozen txn list from a provider account, defaulting empty.
 * @param account - Provider account record.
 * @returns Frozen txn list typed as readonly IBankTransaction[].
 */
function extractAccountTxns(account: ProviderAccount): readonly IBankTransaction[] {
  const hasTxns = Array.isArray(account.txns);
  if (!hasTxns) return [];
  return account.txns;
}

/**
 * Maps a single provider account record into a canonical account.
 * @param account - Provider account record.
 * @param opts - Surrounding mapper opts providing sign policy + bankId.
 * @returns ICanonicalAccount with sign-normalized transactions.
 */
function mapAccount(
  account: ProviderAccount, opts: IMapToCanonicalOpts,
): ICanonicalAccount {
  const accountTxns = extractAccountTxns(account);
  const txns = applySignPolicy(accountTxns, opts);
  return { accountNumber: account.accountNumber, balance: account.balance ?? null, txns };
}

/**
 * Picks the raw provider accounts from an IRawScrape envelope, defaulting empty.
 * @param opts - Raw scrape envelope.
 * @returns Provider account list, or empty when raw scrape failed.
 */
function pickRawAccounts(opts: IMapToCanonicalOpts): readonly ProviderAccount[] {
  if (!opts.raw.raw.success) return [];
  return opts.raw.raw.accounts ?? [];
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
  const rawAccounts = pickRawAccounts(opts);
  const accounts = rawAccounts.map(account => mapAccount(account, opts));
  const metadata = buildMetadata(opts);
  return {
    bankId: opts.raw.bankId, scrapedAt: new Date().toISOString(), accounts, metadata,
  };
}