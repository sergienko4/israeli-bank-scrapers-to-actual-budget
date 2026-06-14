/**
 * Sign-policy application for raw provider transactions.
 *
 * The forward mapper delegates sign-flip decisions to this module so the
 * normalizer dispatch stays isolated from account shape mapping.
 */

import type { IBankTransaction } from '../../Types/Index.js';
import normalizeCreditCardSigns from '../TransactionNormalizer.js';
import type { IMapToCanonicalOpts } from './IScrapeResultMapper.js';

/**
 * Applies the registry-supplied sign policy to a list of transactions.
 * @param txns - Provider transactions; not mutated.
 * @param opts - Mapper opts whose bankId drives normalizer dispatch.
 * @returns A new array of transactions with signs flipped when policy demands.
 */
export default function applySignPolicy(
  txns: readonly IBankTransaction[], opts: IMapToCanonicalOpts,
): readonly IBankTransaction[] {
  if (opts.signPolicy !== 'flip-credit') return [...txns];
  return normalizeCreditCardSigns(opts.raw.bankId, txns);
}
