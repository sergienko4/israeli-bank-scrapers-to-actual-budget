/**
 * Defines metrics data contracts shared by import summaries.
 *
 * @internal
 */
import type { ITransactionRecord } from '../../Types/Index.js';

export type { ITransactionRecord } from '../../Types/Index.js';

export interface IAccountMetrics {
  accountNumber: string;
  accountName?: string;
  balance?: number;
  currency?: string;
  newTransactions: ITransactionRecord[];
  existingTransactions: ITransactionRecord[];
}

export interface IAccountTransactionsRecord {
  accountNumber: string;
  accountName?: string;
  balance: number | undefined;
  currency: string | undefined;
  newTransactions: ITransactionRecord[];
  existingTransactions: ITransactionRecord[];
}

export interface IBankMetrics {
  bankName: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'pending' | 'success' | 'failure';
  error?: string;
  transactionsImported: number;
  transactionsSkipped: number;
  reconciliationStatus?: 'created' | 'skipped' | 'already-reconciled';
  reconciliationAmount?: number;
  accounts: IAccountMetrics[];
}

export interface IImportSummary {
  totalBanks: number;
  successfulBanks: number;
  failedBanks: number;
  totalTransactions: number;
  totalDuplicates: number;
  totalDuration: number;
  averageDuration: number;
  successRate: number;
  banks: IBankMetrics[];
}
