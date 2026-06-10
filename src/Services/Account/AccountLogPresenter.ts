/**
 * AccountLogPresenter — owns the per-account presentation surface: the
 * "Processing account" log header and the dry-run preview recording.
 *
 * Bundles the two side-effecting helpers (one logger-only, one collector-only)
 * that AccountImporter used to inline. Keeping them together makes one obvious
 * place for any future change to per-account I/O presentation.
 */
import { getLogger } from '../../Logger/Index.js';
import type { IBankTransaction } from '../../Types/Index.js';
import { DryRunCollector } from '../DryRunCollector.js';

/** Per-account info shown in the "Processing account" log header. */
export interface IAccountLogInfo {
  /** The bank account number. */
  accountNumber: string;
  /** Optional account display name. */
  accountName?: string;
  /** Optional account balance in currency units. */
  balance: number | undefined;
  /** Currency code (e.g. 'ILS'). */
  currency: string;
  /** Number of transactions to be processed for this account. */
  txnCount: number;
}

/** Account data passed to the dry-run collector. */
export interface IDryRunAccount {
  /** The bank account number. */
  accountNumber: string;
  /** Scraped balance in currency units, when known. */
  balance?: number;
  /** Transactions found by the scraper. */
  txns: IBankTransaction[];
}

/** Dependencies injected into AccountLogPresenter. */
export interface IAccountLogPresenterOpts {
  /** Collector that captures account previews in dry-run mode. */
  dryRunCollector: DryRunCollector;
}

/** Renders the per-account log header and records dry-run account previews. */
export class AccountLogPresenter {
  /**
   * Creates an AccountLogPresenter with the given dependencies.
   * @param opts - Helpers needed for the presentation surface.
   */
  constructor(private readonly opts: IAccountLogPresenterOpts) {}

  /**
   * Logs account label, balance, and transaction count before processing begins.
   * @param info - Structured account info to display.
   */
  public static logAccountInfo(info: IAccountLogInfo): void {
    const label = info.accountName
      ? `${info.accountName} (${info.accountNumber})` : info.accountNumber;
    getLogger().info(`\n  💳 Processing account: ${label}`);
    const bal = info.balance === undefined ? 'N/A' : `${String(info.balance)} ${info.currency}`;
    getLogger().info(`     Balance: ${bal}`);
    getLogger().info(`     Transactions: ${String(info.txnCount)}`);
  }

  /**
   * Records a dry-run account preview in the injected DryRunCollector.
   * @param bankName - The bank this account belongs to.
   * @param account - Account data from the scraper.
   * @param currency - Currency code for the account.
   * @returns Always {imported: 0, skipped: 0} in dry-run mode.
   */
  public collectDryRunAccount(
    bankName: string, account: IDryRunAccount, currency: string,
  ): { imported: number; skipped: number } {
    const preview = DryRunCollector.buildPreview({
      bankName, accountNumber: account.accountNumber,
      balance: account.balance, currency, txns: account.txns,
    });
    this.opts.dryRunCollector.recordAccount(preview);
    return { imported: 0, skipped: 0 };
  }
}
