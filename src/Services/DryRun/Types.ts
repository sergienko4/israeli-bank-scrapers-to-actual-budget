import type { IBankTransaction } from '../../Types/Index.js';

export interface IAccountPreview {
  bankName: string;
  accountNumber: string;
  balance: number | undefined;
  currency: string;
  transactionCount: number;
  dateRange: { from: string; to: string };
  samples: { date: string; description: string; amount: number }[];
}

export interface IPreviewInput {
  bankName: string;
  accountNumber: string;
  balance: number | undefined;
  currency: string;
  txns: IBankTransaction[];
}
