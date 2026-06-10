/**
 * AccountResolver — finds an existing Actual Budget account or creates
 * a new one, encapsulating the dual-lookup (UUID + name fallback) logic.
 *
 * Extracted from TransactionService so the Actual-API quirk where new
 * accounts get a server-assigned UUID (ignoring the configured one) is
 * isolated behind a Procedure-returning contract per P1 (Result pattern).
 *
 * NOTE on name fallback: Actual Budget may ignore the `id` we pass to
 * `createAccount` and assign its own UUID, so subsequent lookups by ID
 * fail. We retry by matching the deterministic `"bankName - accountNumber"`
 * label and warn on collisions (multiple accounts with the same label).
 */

import type api from '@actual-app/api';

import { getLogger } from '../../Logger/Index.js';
import type { IActualAccount, Procedure } from '../../Types/Index.js';
import { fail, succeed } from '../../Types/Index.js';
import { errorMessage } from '../../Utils/Index.js';

/**
 * Stateful resolver bound to an Actual Budget API instance that
 * returns or creates accounts on demand.
 */
export default class AccountResolver {
  /**
   * Constructs an AccountResolver bound to the supplied Actual Budget API.
   * @param _api - Actual Budget API instance (constructor injected).
   */
  constructor(private readonly _api: typeof api) {}

  /**
   * Returns an existing Actual account or creates a new one with the given UUID.
   * @param accountId - UUID to look up or create.
   * @param bankName - Bank name used when creating the account label.
   * @param accountNumber - Account number used when creating the account label.
   * @returns Procedure wrapping the found or newly created IActualAccount, or failure.
   */
  public async getOrCreateAccount(
    accountId: string, bankName: string, accountNumber: string,
  ): Promise<Procedure<IActualAccount>> {
    try {
      const accounts = await this._api.getAccounts() as IActualAccount[];
      const accountLabel = `${bankName} - ${accountNumber}`;
      const existing = AccountResolver.findExistingAccount(accounts, accountId, accountLabel);
      if (existing) return succeed(existing);

      getLogger().info(`     ➕ Creating new account: ${accountId}`);
      return await this.createNewAccount(accountId, accountLabel);
    } catch (error: unknown) {
      return fail(`Account lookup failed: ${errorMessage(error)}`, { error: error as Error });
    }
  }

  /**
   * Finds an existing account by ID or by name (fallback).
   * Actual Budget may assign its own UUID, ignoring the configured ID;
   * the name fallback handles this by matching the deterministic label.
   * @param accounts - All accounts from Actual Budget.
   * @param accountId - Configured account UUID to match first.
   * @param accountLabel - Deterministic label ("bankName - accountNumber").
   * @returns The matching account, or undefined if neither lookup hits.
   */
  private static findExistingAccount(
    accounts: IActualAccount[], accountId: string, accountLabel: string,
  ): IActualAccount | undefined {
    const byId = accounts.find((a) => a.id === accountId);
    if (byId) return byId;
    const byName = accounts.filter((a) => a.name === accountLabel);
    // byName[0] is undefined when length === 0; using the array access
    // satisfies the project's no-restricted-syntax rule which forbids
    // a bare `return undefined`.
    if (byName.length === 0) return byName[0];
    if (byName.length > 1) {
      getLogger().warn(
        `     ⚠️ ${String(byName.length)} accounts named "${accountLabel}" — using ${byName[0].id}`,
      );
    }
    getLogger().info(`     Found existing account by name: ${accountLabel} (${byName[0].id})`);
    return byName[0];
  }

  /**
   * Creates a new Actual Budget account and returns it as a Procedure.
   * @param accountId - UUID for the new account.
   * @param accountLabel - Display name for the new account.
   * @returns Procedure wrapping the created IActualAccount.
   */
  private async createNewAccount(
    accountId: string, accountLabel: string,
  ): Promise<Procedure<IActualAccount>> {
    try {
      const created = await this._api.createAccount({
        id: accountId, name: accountLabel, offbudget: false, closed: false,
      } as Omit<IActualAccount, 'id'>);
      if (!created) return fail('account creation returned empty', { status: 'account-not-found' });
      if (typeof created === 'string') return succeed({ id: created, name: accountLabel });
      return succeed(created as IActualAccount);
    } catch (error: unknown) {
      return fail(`Account creation failed: ${errorMessage(error)}`, { error: error as Error });
    }
  }
}
