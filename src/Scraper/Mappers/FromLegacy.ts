/**
 * Legacy → canonical bridge — adapts already-sign-normalized legacy
 * provider results into the phase-3 canonical shape with synthetic
 * scrape-window metadata derived from the bank config.
 */

import type {
  IBankConfig, IBankTransaction, ICanonicalAccount, ICanonicalScrapeResult, ISignPolicy, Procedure,
} from '../../Types/Index.js';
import { fail, succeed } from '../../Types/Index.js';
import { formatDate } from '../../Utils/Index.js';
import { computeStartDate } from '../BankScraper.js';
import type { ILegacyToCanonicalOpts } from './IScrapeResultMapper.js';
import type { ProviderAccount } from './Types.js';

/**
 * Extracts a frozen txn list from a legacy provider account.
 * @param account - Legacy provider account record.
 * @returns Frozen txn list typed as readonly IBankTransaction[].
 */
function extractLegacyTxns(account: ProviderAccount): readonly IBankTransaction[] {
  const hasTxns = Array.isArray(account.txns);
  if (!hasTxns) return [];
  return [...account.txns] as readonly IBankTransaction[];
}

/**
 * Maps a single legacy provider account into a canonical account.
 * Sign normalization is assumed already applied by BankScraper.
 * @param account - Legacy provider account record.
 * @returns ICanonicalAccount with frozen txn list.
 */
function legacyAccountToCanonical(account: ProviderAccount): ICanonicalAccount {
  const txns = extractLegacyTxns(account);
  return { accountNumber: account.accountNumber, balance: account.balance ?? null, txns };
}

/**
 * Formats the scrape window for legacy adaptation as ISO date strings.
 * @param bankConfig - Bank config used to derive the scrape start date.
 * @returns Object containing formatted startDate and endDate strings.
 */
function formatScrapeWindow(bankConfig: IBankConfig): { startDate: string; endDate: string } {
  const startDate = computeStartDate(bankConfig);
  const endDate = new Date();
  return { startDate: formatDate(startDate), endDate: formatDate(endDate) };
}

/**
 * Builds the synthetic canonical metadata block for legacy adaptation.
 * @param bankConfig - Bank config used to derive the scrape start date.
 * @param signPolicy - Sign policy applied upstream by BankScraper.
 * @returns Frozen ICanonicalScrapeMetadata for the current run.
 */
function buildLegacyMetadata(
  bankConfig: IBankConfig, signPolicy: ISignPolicy,
): ICanonicalScrapeResult['metadata'] {
  const window = formatScrapeWindow(bankConfig);
  return {
    startDate: window.startDate, endDate: window.endDate,
    signPolicyApplied: signPolicy, strategy: 'live', attemptCount: 1,
  };
}

/**
 * Wraps mapped legacy accounts into a canonical scrape envelope.
 * @param opts - Legacy result + bank name + bank config.
 * @returns Frozen canonical scrape result.
 */
function buildLegacyCanonical(opts: ILegacyToCanonicalOpts): ICanonicalScrapeResult {
  const rawAccounts = opts.legacy.accounts ?? [];
  const accounts = rawAccounts.map(legacyAccountToCanonical);
  const metadata = buildLegacyMetadata(opts.bankConfig, opts.signPolicy);
  return {
    bankId: opts.bankName, scrapedAt: new Date().toISOString(), accounts, metadata,
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
  const canonical = buildLegacyCanonical(opts);
  return succeed(canonical);
}