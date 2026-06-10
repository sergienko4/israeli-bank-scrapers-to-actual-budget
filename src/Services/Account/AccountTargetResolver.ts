/**
 * AccountTargetResolver — resolves a configured IBankTarget for a given account number.
 *
 * Encapsulates the target-lookup logic previously private inside AccountImporter so
 * that the orchestration class can stay focused on flow control. Returns a Procedure
 * to comply with the project's Result Pattern (P1) — callers branch on isFail()
 * rather than handling raw `undefined`.
 */
import type { IBankConfig, IBankTarget, Procedure } from '../../Types/Index.js';
import { fail, succeed } from '../../Types/Index.js';

/**
 * Finds the IBankTarget covering the given account number.
 *
 * A target covers an account when its `accounts` field is the literal string
 * 'all' or an array containing the account number.
 *
 * @param bankConfig - Bank configuration whose targets list is searched.
 * @param accountNumber - The bank account number to match.
 * @returns succeed(target) when a target is configured; fail('no-target') otherwise.
 */
export default function findTargetForAccount(
  bankConfig: IBankConfig, accountNumber: string,
): Procedure<IBankTarget> {
  const target = bankConfig.targets?.find(t =>
    t.accounts === 'all' || (Array.isArray(t.accounts) && t.accounts.includes(accountNumber)),
  );
  return target
    ? succeed(target, 'target-found')
    : fail('No target configured for this account', { status: 'no-target' });
}
