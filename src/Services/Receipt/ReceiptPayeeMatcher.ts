/**
 * findReceiptPayeeMatch — looks up the most-recent prior transaction whose
 * imported_payee matches the OCR'd merchant name, and resolves that
 * transaction's account/category IDs to display names.
 *
 * Stateless module: the caller passes the connected Actual Budget API into
 * each call, so the helpers do not need to track late binding of the API.
 */

import { getLogger } from '../../Logger/Index.js';
import { errorMessage } from '../../Utils/Index.js';
import type { IReceiptActualApi } from './Types.js';

/** Named account + category match found in a previous transaction. */
export interface IPayeeMatch {
  accId: string;
  accName: string;
  catId: string;
  catName: string;
}

/**
 * Finds the most-recent account/category previously used for the merchant.
 * @param api - The connected Actual Budget API.
 * @param merchant - Merchant name extracted from the receipt OCR.
 * @returns Named match data, or false when no match is found.
 */
export default async function findReceiptPayeeMatch(
  api: IReceiptActualApi, merchant?: string,
): Promise<IPayeeMatch | false> {
  if (!merchant) return false;
  try { return await queryPayeeMatch(api, merchant); }
  catch (err: unknown) {
    getLogger().debug(`payee match: ${errorMessage(err)}`);
    return false;
  }
}

/**
 * Executes the AQL query and resolves names for the top hit.
 * @param api - The connected Actual Budget API.
 * @param merchant - Merchant name to search for (LIKE wildcards escaped).
 * @returns Named match data, or false when no rows are returned.
 */
async function queryPayeeMatch(
  api: IReceiptActualApi, merchant: string,
): Promise<IPayeeMatch | false> {
  const safeMerchant = merchant.replaceAll('%', String.raw`\%`).replaceAll('_', String.raw`\_`);
  const query = api.q('transactions')
    .filter({ imported_payee: { $like: `%${safeMerchant}%` }, category: { $ne: null } })
    .select(['account', 'category'])
    .orderBy({ date: 'desc' });
  const raw = await api.aqlQuery(query);
  const data = (raw as { data?: { account: string; category: string }[] } | null)?.data;
  if (!data || data.length === 0) return false;
  return await resolveMatchNames(api, data[0]);
}

/**
 * Resolves account and category names for a matched transaction.
 * @param api - The connected Actual Budget API.
 * @param txn - The matched transaction with account and category IDs.
 * @param txn.account - The Actual Budget account UUID.
 * @param txn.category - The Actual Budget category UUID.
 * @returns Named match, or false when names cannot be resolved.
 */
async function resolveMatchNames(
  api: IReceiptActualApi, txn: { account: string; category: string },
): Promise<IPayeeMatch | false> {
  const accounts = await api.getAccounts();
  const categories = await api.getCategories();
  const acc = accounts.find(a => a.id === txn.account);
  const cat = categories.find(c => c.id === txn.category);
  if (!acc || !cat) return false;
  return { accId: acc.id, accName: acc.name, catId: cat.id, catName: cat.name };
}
