/**
 * History-based category resolver
 * Queries ALL accounts for the most recent transaction with the same payee that has a category.
 * Uses that category for new transactions.
 */

import type api from '@actual-app/api';
import { ResolvedCategory } from '../types/index.js';
import { ICategoryResolver } from './ICategoryResolver.js';
import { extractQueryData } from '../utils/index.js';
import { getLogger } from '../logger/index.js';

interface PayeeCategory {
  imported_payee: string;
  category: string;
  date: string;
}

export class HistoryCategoryResolver implements ICategoryResolver {
  private categoryMap = new Map<string, string>();
  private actualApi: typeof api;

  constructor(actualApi: typeof api) {
    this.actualApi = actualApi;
  }

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

  resolve(description: string): ResolvedCategory | undefined {
    if (!description) return undefined;
    const categoryId = this.findExactMatch(description) ?? this.findPartialMatch(description);
    return categoryId ? { categoryId } : undefined;
  }

  private findExactMatch(description: string): string | undefined {
    return this.categoryMap.get(description.toLowerCase());
  }

  private findPartialMatch(description: string): string | undefined {
    const lower = description.toLowerCase();
    for (const [payee, categoryId] of this.categoryMap) {
      if (lower.includes(payee) || payee.includes(lower)) return categoryId;
    }
    return undefined;
  }

  private async queryPayeeCategories(): Promise<PayeeCategory[]> {
    const result = await this.actualApi.runQuery(
      this.actualApi.q('transactions')
        .filter({ category: { $ne: null } })
        .select(['imported_payee', 'category', 'date'])
        .orderBy({ date: 'desc' })
    );
    return extractQueryData<PayeeCategory[]>(result, []);
  }

  private buildMap(rows: PayeeCategory[]): void {
    for (const row of rows) {
      if (!row.imported_payee) continue;
      const key = row.imported_payee.toLowerCase();
      if (!this.categoryMap.has(key)) this.categoryMap.set(key, row.category);
    }
  }
}
