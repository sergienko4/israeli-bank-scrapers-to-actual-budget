/**
 * Category resolver interface — resolves a transaction description to a category
 * or translated payee. Implementations: HistoryCategoryResolver, TranslateCategoryResolver
 */

import type { IResolvedCategory, Procedure } from '../Types/Index.js';

export interface ICategoryResolver {
  /**
   * Loads or prepares internal state needed for category resolution.
   * @returns Procedure indicating initialization status.
   */
  initialize(): Promise<Procedure<{ status: string }>>;

  /**
   * Resolves a transaction description to a category or translated payee.
   * @param description - The raw transaction payee or description string.
   * @returns Procedure with the resolved category, or failure if no match.
   */
  resolve(description: string): Procedure<IResolvedCategory>;
}
