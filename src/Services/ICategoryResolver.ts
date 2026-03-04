/**
 * Category resolver interface — resolves a transaction description to a category
 * or translated payee. Implementations: HistoryCategoryResolver, TranslateCategoryResolver
 */

import type { ResolvedCategory } from '../Types/Index.js';

export interface ICategoryResolver {
  initialize(): Promise<void>;
  resolve(description: string): ResolvedCategory | undefined;
}
