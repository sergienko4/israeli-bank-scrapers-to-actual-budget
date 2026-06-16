/**
 * TransactionService - Handles transaction import into Actual Budget
 * Follows Single Responsibility Principle: Only handles transaction import logic
 */

import type api from '@actual-app/api';

import { getLogger } from '../Logger/Index.js';
import type {
  IActualAccount, IBankTransaction, ITransactionRecord, Procedure} from '../Types/Index.js';
import { fail, succeed } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';
import type { ICategoryResolver } from './ICategoryResolver.js';
import AccountResolver from './Transaction/AccountResolver.js';
import DedupQuery from './Transaction/DedupQuery.js';
import type { IBatchOutcome, ITransactionBatchImporter } from './Transaction/TransactionBatchImporter.js';
import TransactionBatchImporter from './Transaction/TransactionBatchImporter.js';

export interface IImportResult {
  imported: number;
  skipped: number;
  newTransactions: ITransactionRecord[];
  existingTransactions: ITransactionRecord[];
}

export interface IImportTransactionsOpts {
  bankName: string;
  accountNumber: string;
  actualAccountId: string;
  transactions: IBankTransaction[];
}

/** Handles importing bank transactions into Actual Budget. */
export class TransactionService {
  private readonly _accountResolver: AccountResolver;
  private readonly _batchImporter: ITransactionBatchImporter;

  /**
   * Creates a TransactionService with the given Actual API and optional category resolver.
   * @param actualApi - The Actual Budget API module for all database operations.
   * @param categoryResolver - Optional resolver to auto-assign categories by description.
   * @param batchImporter - Optional batch importer; defaults to a concrete
   *   {@link TransactionBatchImporter}. Injectable as an {@link ITransactionBatchImporter}
   *   seam so import orchestration can be driven by a fake in tests.
   */
  constructor(
    actualApi: typeof api,
    categoryResolver?: ICategoryResolver,
    batchImporter?: ITransactionBatchImporter,
  ) {
    this._accountResolver = new AccountResolver(actualApi);
    this._batchImporter =
      batchImporter ??
      new TransactionBatchImporter(actualApi, new DedupQuery(actualApi), categoryResolver);
  }

  /**
   * Imports transactions for an account into Actual Budget.
   * @param opts - Options including bank name, account number, account ID, and transactions.
   * @returns Procedure wrapping IImportResult with counts of new and skipped transactions.
   */
  public async importTransactions(
    opts: IImportTransactionsOpts
  ): Promise<Procedure<IImportResult>> {
    getLogger().info(
      `     📥 Importing ${String(opts.transactions.length)} transactions...`
    );
    try {
      const outcome = await this._batchImporter.processBatch(opts);
      return TransactionService.buildImportResult(outcome);
    } catch (error: unknown) {
      return fail(`Transaction import failed: ${errorMessage(error)}`, { error: error as Error });
    }
  }

  /**
   * Logs the batch outcome and wraps it as a successful Procedure.
   * @param outcome - Per-account split of new and already-imported transactions.
   * @returns Procedure wrapping IImportResult with imported / skipped counts.
   */
  private static buildImportResult(outcome: IBatchOutcome): Procedure<IImportResult> {
    const { newTransactions, existingTransactions } = outcome;
    getLogger().info(
      `     ✅ New: ${String(newTransactions.length)}, ` +
        `Existing: ${String(existingTransactions.length)}`
    );
    return succeed({
      imported: newTransactions.length, skipped: existingTransactions.length,
      newTransactions, existingTransactions
    });
  }

  /**
   * Returns an existing Actual account or creates a new one with the given UUID.
   *
   * Delegates to {@link AccountResolver} (extracted at PR #423/c3) to keep
   * this class focused on transaction orchestration.
   *
   * @param accountId - UUID to look up or create.
   * @param bankName - Bank name used when creating the account label.
   * @param accountNumber - Account number used when creating the account label.
   * @returns Procedure wrapping the found or newly created IActualAccount, or failure.
   */
  public async getOrCreateAccount(
    accountId: string, bankName: string, accountNumber: string
  ): Promise<Procedure<IActualAccount>> {
    return await this._accountResolver.getOrCreateAccount(accountId, bankName, accountNumber);
  }
}
