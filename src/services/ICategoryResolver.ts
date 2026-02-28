/**
 * Category resolver interface — resolves a transaction description to a category
 * or translated payee. Implementations: HistoryCategoryResolver, TranslateCategoryResolver
 */

import { ResolvedCategory } from '../types/index.js';

export interface ICategoryResolver {
  initialize(): Promise<void>;
  resolve(description: string): ResolvedCategory | undefined;
}
