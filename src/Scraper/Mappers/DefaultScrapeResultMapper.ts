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
  IBankConfig, IBankTransaction, ICanonicalAccount, ICanonicalScrapeResult, Procedure,
} from '../../Types/Index.js';
import { fail, succeed } from '../../Types/Index.js';
import { formatDate } from '../../Utils/Index.js';
import { computeStartDate } from '../BankScraper.js';
import normalizeCreditCardSigns from '../TransactionNormalizer.js';
import type {
  ILegacyToCanonicalOpts, IMapToCanonicalOpts, IScrapeResultMapper,
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
function buildLegacyMetadata(bankConfig: IBankConfig): {
  startDate: string;
  endDate: string;
  signPolicyApplied: 'preserve';
  strategy: 'live';
  attemptCount: number;
} {
  const startDate = computeStartDate(bankConfig);
  const endDate = new Date();
  return {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    signPolicyApplied: 'preserve' as const,
    strategy: 'live' as const,
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
function legacyToCanonical(
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

/**
 * Constructs the default mapper used at the composition root.
 * @returns Singleton-safe IScrapeResultMapper with no external state.
 */
export default function createScrapeResultMapper(): IScrapeResultMapper {
  return { mapToCanonical, canonicalToLegacy, legacyToCanonical };
}
