/**
 * Transaction categorization mode and payee-translation rules.
 */

/** Supported transaction-categorization modes (single source for type + UI). */
export const CATEGORIZATION_MODES = ['none', 'history', 'translate'] as const;

/** Transaction categorization mode. Default: 'none'. */
export type CategorizationMode = typeof CATEGORIZATION_MODES[number];

export interface ITranslationRule {
  fromPayee: string;   // Hebrew text to find in bank payee name
  toPayee: string;     // English name to use in Actual Budget
}

export interface ICategorizationConfig {
  mode?: CategorizationMode;        // Default: 'none'
  translations?: ITranslationRule[]; // Only used when mode='translate'
}

/** Result of category resolution — either a category ID or a payee translation */
export interface IResolvedCategory {
  categoryId?: string;     // For history mode
  payeeName?: string;      // For translate mode (translated name)
  importedPayee?: string;  // Original name (preserved for reference)
}
