/**
 * DefaultScrapeResultMapper — maps raw provider results into canonical
 * scrape results and (for back-compat) back to IScraperScrapingResult.
 *
 * Sign normalization is delegated to TransactionNormalizer; this mapper
 * decides whether to apply it based on the registry-supplied ISignPolicy
 * passed by the BankScraper coordinator.
 */

import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';

import type {
  IBankTransaction, ICanonicalAccount, ICanonicalScrapeResult,
} from '../../Types/Index.js';
import { formatDate } from '../../Utils/Index.js';
import normalizeCreditCardSigns from '../TransactionNormalizer.js';
import type {
  IMapToCanonicalOpts, IScrapeResultMapper,
} from './IScrapeResultMapper.js';

type ProviderAccount = NonNullable<IScraperScrapingResult['accounts']>[number];

/**
 * Applies the registry-supplied sign policy to a list of transactions.
 * @param txns - Provider transactions; not mutated.
 * @param opts - Mapper opts whose bankId drives normalizer dispatch.
 * @returns A new array of transactions with signs flipped when policy demands.
 */
function applySignPolicy(
  txns: readonly IBankTransaction[], opts: IMapToCanonicalOpts,
): readonly IBankTransaction[] {
  if (opts.signPolicy !== 'flip-credit') return [...txns];
  return normalizeCreditCardSigns(opts.raw.bankId, txns);
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
 * Maps a raw provider scrape into a canonical scrape result.
 * @param opts - Raw scrape, sign policy, and scrape window dates.
 * @returns ICanonicalScrapeResult with normalized accounts + metadata.
 */
function mapToCanonical(opts: IMapToCanonicalOpts): ICanonicalScrapeResult {
  const rawAccounts = opts.raw.raw.success && opts.raw.raw.accounts
    ? opts.raw.raw.accounts : [];
  const accounts = rawAccounts.map(account => mapAccount(account, opts));
  const startStr = formatDate(opts.startDate);
  const endStr = formatDate(opts.endDate);
  return {
    bankId: opts.raw.bankId,
    scrapedAt: new Date().toISOString(),
    accounts,
    metadata: {
      startDate: startStr,
      endDate: endStr,
      signPolicyApplied: opts.signPolicy,
      strategy: opts.raw.strategy,
      attemptCount: opts.raw.attemptCount,
    },
  };
}

/**
 * Adapts a canonical scrape result back to the legacy provider shape.
 * Preserves provider-only fields (futureDebits, persistentOtpToken,
 * diagnostics) so existing consumers see no behavior change.
 * @param canonical - Canonical scrape result produced by mapToCanonical.
 * @param originalRaw - Original provider result for pass-through fields.
 * @returns IScraperScrapingResult equivalent to legacy BankScraper output.
 */
function canonicalToLegacy(
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

/**
 * Constructs the default mapper used at the composition root.
 * @returns Singleton-safe IScrapeResultMapper with no external state.
 */
export default function createScrapeResultMapper(): IScrapeResultMapper {
  return { mapToCanonical, canonicalToLegacy };
}
