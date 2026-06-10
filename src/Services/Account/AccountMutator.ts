/**
 * Pure helper for normalizing the canonical (readonly) account shape into
 * the mutable shape consumed by the per-account import loop. Extracted from
 * `AccountImporter` so the coordinator stays focused on orchestration and
 * the conversion is independently unit-testable.
 */
import type { IBankTransaction, ICanonicalAccount } from '../../Types/Index.js';

/** Mutable account shape used by the per-account import loop. */
export interface IMutableAccount {
  accountNumber: string;
  balance?: number;
  txns: IBankTransaction[];
}

/**
 * Converts a canonical account (readonly, balance: null|number) into the
 * mutable shape consumed by the per-account loop (balance: number | undefined).
 * @param account - Canonical account from the mapper.
 * @returns Mutable account with balance normalized to optional number.
 */
export function toMutableAccount(account: ICanonicalAccount): IMutableAccount {
  return {
    accountNumber: account.accountNumber,
    balance: account.balance ?? undefined,
    txns: [...account.txns],
  };
}


