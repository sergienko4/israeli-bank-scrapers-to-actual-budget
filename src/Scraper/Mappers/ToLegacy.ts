/**
 * Canonical → legacy bridge — adapts a canonical scrape result back to
 * the legacy provider shape. Preserves provider-only fields (futureDebits,
 * persistentOtpToken, diagnostics) so existing consumers see no behavior
 * change while the phase-3 boundary is rolled out.
 */

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';

import type { ICanonicalScrapeResult } from '../../Types/Index.js';

type ProviderAccount = NonNullable<IScraperScrapingResult['accounts']>[number];

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
  const accounts: ProviderAccount[] = canonical.accounts.map(account => ({
    accountNumber: account.accountNumber,
    balance: account.balance ?? undefined,
    txns: [...account.txns] as ProviderAccount['txns'],
  }));
  return { ...originalRaw, accounts };
}
