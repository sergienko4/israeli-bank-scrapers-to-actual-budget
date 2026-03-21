/**
 * Category resolver interface — resolves a transaction description to a category
 * or translated payee. Implementations: HistoryCategoryResolver, TranslateCategoryResolver
 */

import type { IResolvedCategory, Procedure } from '../Types/Index.js';

export interface ICategoryResolver {
  initialize(): Promise<Procedure<{ status: string }>>;
  resolve(description: string): Procedure<IResolvedCategory>;
}
