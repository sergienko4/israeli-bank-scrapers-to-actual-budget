/**
 * DedupQuery — wraps the AQL query that fetches every `imported_id`
 * value already in an Actual Budget account, so callers can build a
 * `Set<string>` for fast O(1) dedup before importing new transactions.
 *
 * Extracted from TransactionService so the AQL shape + null filtering
 * are testable in isolation against a mocked Actual API.
 *
 * NOTE on AQL shape: deliberately OMITS `$ne: null` filter — some Actual
 * Budget versions return an empty result set with that filter applied.
 * Nulls are stripped client-side via a typed predicate instead.
 */

import type api from '@actual-app/api';

import { getLogger } from '../../Logger/Index.js';

/**
 * Wraps the AQL query that fetches every `imported_id` value already in
 * an Actual Budget account, exposing it as a typed `Set<string>` for
 * fast O(1) dedup before importing new transactions.
 */
export default class DedupQuery {
  /**
   * Constructs a DedupQuery bound to the supplied Actual Budget API.
   * @param _api - Actual Budget API instance (constructor injected).
   */
  constructor(private readonly _api: typeof api) {}

  /**
   * Queries Actual Budget for all imported_id values already in the account.
   * @param accountId - UUID of the Actual account to query.
   * @returns Set of imported_id strings for fast duplicate detection.
   */
  public async getExistingImportedIds(accountId: string): Promise<Set<string>> {
    const data = await this.queryImportedIdRows(accountId);
    if (!data) {
      getLogger().warn(`No existing imported IDs found for account ${accountId}`);
      return new Set<string>();
    }
    const ids = data.map((t) => t.imported_id).filter((id): id is string => id !== null);
    getLogger().debug(`     Dedup: ${String(ids.length)} existing imported IDs for ${accountId}`);
    return new Set(ids);
  }

  /**
   * Runs the AQL query that selects every `imported_id` row for an account.
   * Returns undefined when Actual yields no data field (some versions return
   * a null result), letting the caller emit the empty-set warning.
   * @param accountId - UUID of the Actual account to query.
   * @returns The raw imported_id rows, or undefined when no data is present.
   */
  private async queryImportedIdRows(
    accountId: string,
  ): Promise<{ imported_id: string | null }[] | undefined> {
    const query = this._api.q('transactions')
      .filter({ account: accountId })
      .select(['imported_id']);
    const result = await this._api.aqlQuery(query);
    return (result as { data?: { imported_id: string | null }[] } | null)?.data;
  }
}
