/**
 * History-based category resolver
 * Queries ALL accounts for the most recent transaction with the same payee that has a category.
 * Uses that category for new transactions.
 */

import type api from '@actual-app/api';

import { getLogger } from '../Logger/Index.js';
import type { IResolvedCategory, Procedure } from '../Types/Index.js';
import { fail, succeed } from '../Types/Index.js';
import { extractQueryData } from '../Utils/Index.js';
import type { ICategoryResolver } from './ICategoryResolver.js';

interface IPayeeCategory {
  imported_payee: string;
  category: string;
  date: string;
}

/** Resolves transaction categories by matching payee names against import history. */
export default class HistoryCategoryResolver implements ICategoryResolver {
  private readonly _categoryMap = new Map<string, string>();
  private readonly _actualApi: typeof api;

  /**
   * Creates a HistoryCategoryResolver using the given Actual API instance.
   * @param actualApi - The Actual Budget API module to query transaction history from.
   */
  constructor(actualApi: typeof api) {
    this._actualApi = actualApi;
  }

  /**
   * Loads historical payee→category mappings from Actual Budget transaction history.
   * Failures are logged and do not throw; the resolver will simply return no matches.
   * @returns Procedure with the result status, or failure with error details.
   */
  public async initialize(): Promise<Procedure<{ status: string }>> {
    try {
      const rows = await this.queryPayeeCategories();
      this.buildMap(rows);
      getLogger().info(`  📂 Category history loaded: ${String(this._categoryMap.size)} payees`);
      return succeed({ status: 'initialized' });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      getLogger().error(`  ⚠️  Category history failed to load: ${msg}`);
      return fail(`category history load failed: ${msg}`);
    }
  }

  /**
   * Finds the most recent historical category for the given payee description.
   * @param description - The transaction description or payee name to match.
   * @returns A IResolvedCategory with the matched category ID, or undefined if no match.
   */
  public resolve(description: string): Procedure<IResolvedCategory> {
    if (!description) return fail('empty description');
    const categoryId = this.findExactMatch(description)
      || this.findPartialMatch(description);
    if (!categoryId) return fail(`no match for "${description}"`);
    return succeed({ categoryId });
  }

  /**
   * Looks up the exact lowercased description in the category map.
   * @param description - The description to look up.
   * @returns The matching category ID, or empty string if not found.
   */
  private findExactMatch(description: string): string {
    const lowerDescription = description.toLowerCase();
    return this._categoryMap.get(lowerDescription) ?? '';
  }

  /**
   * Searches for a partial substring match between the description and known payees.
   * @param description - The description to match against known payees.
   * @returns The first matching category ID, or empty string if no match.
   */
  private findPartialMatch(description: string): string {
    const lower = description.toLowerCase();
    for (const [payee, categoryId] of this._categoryMap) {
      if (lower.includes(payee) || payee.includes(lower)) return categoryId;
    }
    return '';
  }

  /**
   * Queries Actual Budget for all transactions that have a category and imported_payee.
   * @returns Array of IPayeeCategory rows from the most recent transactions first.
   */
  private async queryPayeeCategories(): Promise<IPayeeCategory[]> {
    const query = this._actualApi.q('transactions')
      .filter({ category: { $ne: null } })
      .select(['imported_payee', 'category', 'date'])
      .orderBy({ date: 'desc' });
    const result = await this._actualApi.aqlQuery(query);
    return extractQueryData<IPayeeCategory[]>(result, []);
  }

  /**
   * Populates the categoryMap from query rows, keeping the first (most recent) entry per payee.
   * @param rows - Array of IPayeeCategory rows from Actual Budget.
   */
  private buildMap(rows: IPayeeCategory[]): void {
    for (const row of rows) {
      if (!row.imported_payee) continue;
      const key = row.imported_payee.toLowerCase();
      if (!this._categoryMap.has(key)) this._categoryMap.set(key, row.category);
    }
  }
}
