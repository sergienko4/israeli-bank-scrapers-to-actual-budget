/**
 * Canonical → legacy bridge — adapts a canonical scrape result back to
 * the legacy provider shape. Preserves provider-only fields (futureDebits,
 * persistentOtpToken, diagnostics) so existing consumers see no behavior
 * change while the phase-3 boundary is rolled out.
 */

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';

import type { ICanonicalAccount, ICanonicalScrapeResult } from '../../Types/Index.js';
import type { ProviderAccount } from './Types.js';

type CoverageMetadata = Pick<ProviderAccount, 'windowCoverage'>;

/**
 * Retrieves optional provider coverage without adding it to the canonical model.
 * @param accounts - Original provider accounts in canonical mapping order.
 * @param index - Index of the canonical account being restored.
 * @returns Optional coverage metadata for the corresponding provider account.
 */
function coverageMetadata(accounts: readonly ProviderAccount[], index: number): CoverageMetadata {
  const windowCoverage = accounts[index]?.windowCoverage;
  return windowCoverage === undefined ? {} : { windowCoverage };
}

/**
 * Maps a single canonical account into the legacy provider account shape.
 * @param account - Canonical account record.
 * @param coverage - Provider-only coverage metadata to preserve.
 * @returns Legacy provider account with normalized balance + txn copy.
 */
function canonicalAccountToProvider(
  account: ICanonicalAccount, coverage: CoverageMetadata,
): ProviderAccount {
  return {
    accountNumber: account.accountNumber,
    balance: account.balance ?? undefined,
    txns: [...account.txns] as ProviderAccount['txns'],
    ...coverage,
  };
}

/**
 * Restores canonical accounts to provider order with their coverage metadata.
 * @param accounts - Canonical accounts after transaction normalization.
 * @param originalAccounts - Original provider accounts in matching order.
 * @returns Provider-shaped accounts with normalized transactions.
 */
function restoreAccounts(
  accounts: readonly ICanonicalAccount[], originalAccounts: readonly ProviderAccount[],
): ProviderAccount[] {
  return accounts.map(
    /**
     * Restores one canonical account with metadata from the same provider position.
     * @param account - Canonical account whose normalized values are retained.
     * @param index - Matching position in the original provider account list.
     * @returns Provider-shaped account with optional coverage metadata.
     */
    (account, index) => {
      const coverage = coverageMetadata(originalAccounts, index);
      return canonicalAccountToProvider(account, coverage);
    },
  );
}

/**
 * Adapts a canonical scrape result back to the legacy provider shape.
 * @param canonical - Canonical scrape result produced by mapToCanonical.
 * @param originalRaw - Original provider result for pass-through fields.
 * @returns IScraperScrapingResult equivalent to legacy BankScraper output.
 */
export default function canonicalToLegacy(
  canonical: ICanonicalScrapeResult, originalRaw: IScraperScrapingResult,
): IScraperScrapingResult {
  if (!originalRaw.success) return originalRaw;
  const originalAccounts = originalRaw.accounts ?? [];
  const accounts = restoreAccounts(canonical.accounts, originalAccounts);
  return { ...originalRaw, accounts };
}