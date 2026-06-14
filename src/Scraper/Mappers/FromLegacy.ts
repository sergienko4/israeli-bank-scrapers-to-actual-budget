/**
 * Legacy → canonical bridge — adapts already-sign-normalized legacy
 * provider results into the phase-3 canonical shape with synthetic
 * scrape-window metadata derived from the bank config.
 */

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';

import type {
  IBankConfig, IBankTransaction, ICanonicalAccount, ICanonicalScrapeResult, Procedure,
} from '../../Types/Index.js';
import { fail, succeed } from '../../Types/Index.js';
import { formatDate } from '../../Utils/Index.js';
import { computeStartDate } from '../BankScraper.js';
import type { ILegacyToCanonicalOpts } from './IScrapeResultMapper.js';

type ProviderAccount = NonNullable<IScraperScrapingResult['accounts']>[number];

/**
 * Maps a single legacy provider account into a canonical account.
 * Sign normalization is assumed already applied by BankScraper.
 * @param account - Legacy provider account record.
 * @returns ICanonicalAccount with frozen txn list.
 */
function legacyAccountToCanonical(account: ProviderAccount): ICanonicalAccount {
  const hasTxns = Array.isArray(account.txns);
  const txns = hasTxns
    ? ([...(account.txns as readonly IBankTransaction[])] as readonly IBankTransaction[])
    : ([] as readonly IBankTransaction[]);
  return {
    accountNumber: account.accountNumber,
    balance: account.balance ?? null,
    txns,
  };
}

/**
 * Builds the synthetic canonical metadata block for legacy adaptation.
 * @param bankConfig - Bank config used to derive the scrape start date.
 * @returns Frozen ICanonicalScrapeMetadata for the current run.
 */
function buildLegacyMetadata(bankConfig: IBankConfig): ICanonicalScrapeResult['metadata'] {
  const startDate = computeStartDate(bankConfig);
  const endDate = new Date();
  return {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    signPolicyApplied: 'preserve',
    strategy: 'live',
    attemptCount: 1,
  };
}

/**
 * Adapts a legacy provider result (already sign-normalized by BankScraper)
 * into the canonical shape, with synthetic metadata for the scrape window.
 * @param opts - Legacy result + bank name + bank config used to compute dates.
 * @returns Procedure with the canonical scrape result, or fail when the
 *   legacy result signals failure.
 */
export default function legacyToCanonical(
  opts: ILegacyToCanonicalOpts,
): Procedure<ICanonicalScrapeResult> {
  if (!opts.legacy.success) {
    const message = opts.legacy.errorMessage ?? 'Scrape failed';
    return fail(message, { status: 'legacy-not-successful' });
  }
  const rawAccounts = opts.legacy.accounts ?? [];
  const accounts = rawAccounts.map(legacyAccountToCanonical);
  return succeed({
    bankId: opts.bankName,
    scrapedAt: new Date().toISOString(),
    accounts,
    metadata: buildLegacyMetadata(opts.bankConfig),
  });
}
