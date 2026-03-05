/**
 * History-based category resolver
 * Queries ALL accounts for the most recent transaction with the same payee that has a category.
 * Uses that category for new transactions.
 */

import type api from '@actual-app/api';
import type { ResolvedCategory } from '../Types/Index.js';
import type { ICategoryResolver } from './ICategoryResolver.js';
import { extractQueryData } from '../Utils/Index.js';
import { getLogger } from '../Logger/Index.js';

interface PayeeCategory {
  imported_payee: string;
  category: string;
  date: string;
}

/** Resolves transaction categories by matching payee names against import history. */
export class HistoryCategoryResolver implements ICategoryResolver {
  private categoryMap = new Map<string, string>();
  private actualApi: typeof api;

  /**
   * Creates a HistoryCategoryResolver using the given Actual API instance.
   * @param actualApi - The Actual Budget API module to query transaction history from.
   */
  constructor(actualApi: typeof api) {
    this.actualApi = actualApi;
  }

  /**
   * Loads historical payee→category mappings from Actual Budget transaction history.
   * Failures are logged and do not throw; the resolver will simply return no matches.
   */
  async initialize(): Promise<void> {
    try {
      const rows = await this.queryPayeeCategories();
      this.buildMap(rows);
      getLogger().info(`  📂 Category history loaded: ${this.categoryMap.size} payees`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      getLogger().error(`  ⚠️  Category history failed to load: ${msg}`);
    }
  }

  /**
   * Finds the most recent historical category for the given payee description.
   * @param description - The transaction description or payee name to match.
   * @returns A ResolvedCategory with the matched category ID, or undefined if no match.
   */
  resolve(description: string): ResolvedCategory | undefined {
    if (!description) return undefined;
    const categoryId = this.findExactMatch(description) ?? this.findPartialMatch(description);
    return categoryId ? { categoryId } : undefined;
  }

  /**
   * Looks up the exact lowercased description in the category map.
   * @param description - The description to look up.
   * @returns The matching category ID, or undefined if not found.
   */
  private findExactMatch(description: string): string | undefined {
    return this.categoryMap.get(description.toLowerCase());
  }

  /**
   * Searches for a partial substring match between the description and known payees.
   * @param description - The description to match against known payees.
   * @returns The first matching category ID, or undefined if no partial match found.
   */
  private findPartialMatch(description: string): string | undefined {
    const lower = description.toLowerCase();
    for (const [payee, categoryId] of this.categoryMap) {
      if (lower.includes(payee) || payee.includes(lower)) return categoryId;
    }
    return undefined;
  }

  /**
   * Queries Actual Budget for all transactions that have a category and imported_payee.
   * @returns Array of PayeeCategory rows from the most recent transactions first.
   */
  private async queryPayeeCategories(): Promise<PayeeCategory[]> {
    const result = await this.actualApi.runQuery(
      this.actualApi.q('transactions')
        .filter({ category: { $ne: null } })
        .select(['imported_payee', 'category', 'date'])
        .orderBy({ date: 'desc' })
    );
    return extractQueryData<PayeeCategory[]>(result, []);
  }

  /**
   * Populates the categoryMap from query rows, keeping the first (most recent) entry per payee.
   * @param rows - Array of PayeeCategory rows from Actual Budget.
   */
  private buildMap(rows: PayeeCategory[]): void {
    for (const row of rows) {
      if (!row.imported_payee) continue;
      const key = row.imported_payee.toLowerCase();
      if (!this.categoryMap.has(key)) this.categoryMap.set(key, row.category);
    }
  }
}
