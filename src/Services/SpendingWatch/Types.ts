import type { ISpendingWatchRule } from '../../Types/Index.js';

export const MAX_DISPLAYED_TRANSACTIONS = 5;

export interface ITransactionRow {
  date: string;
  imported_payee: string;
  amount: number;
}

export interface IRuleResult {
  rule: ISpendingWatchRule;
  totalSpent: number;
  triggered: boolean;
  matched: ITransactionRow[];
}
