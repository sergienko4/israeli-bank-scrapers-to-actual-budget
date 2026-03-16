/**
 * Translation-based category resolver
 * Maps Hebrew payee names to English using fromPayee/toPayee rules.
 * Longest match wins — "שופרסל" matches before "סופר".
 */

import type { TranslationRule, ResolvedCategory } from '../Types/Index.js';
import type { ICategoryResolver } from './ICategoryResolver.js';
import { getLogger } from '../Logger/Index.js';

interface CompiledRule {
  fromLower: string;
  toPayee: string;
}

/** Resolves transaction payee names by matching Hebrew text against translation rules. */
export class TranslateCategoryResolver implements ICategoryResolver {
  private readonly rules: CompiledRule[];

  /**
   * Creates a TranslateCategoryResolver by pre-compiling the given translation rules.
   * @param translations - Array of TranslationRule objects defining fromPayee→toPayee mappings.
   */
  constructor(translations: TranslationRule[]) {
    this.rules = this.compileRules(translations);
  }

  /**
   * Logs the number of loaded translation rules and returns a resolved promise.
   * @returns Resolved promise (no async work needed).
   */
  initialize(): Promise<void> {
    getLogger().info(`  📂 Payee translations loaded: ${this.rules.length} rules`);
    return Promise.resolve();
  }

  /**
   * Finds the first translation rule matching the given payee description.
   * @param description - The raw transaction payee or description string.
   * @returns ResolvedCategory with the translated payee name, or undefined if no match.
   */
  resolve(description: string): ResolvedCategory | undefined {
    const lower = description.toLowerCase();
    const match = this.rules.find(r => lower.includes(r.fromLower));
    if (!match) return undefined;
    return { payeeName: match.toPayee, importedPayee: description };
  }

  /**
   * Pre-compiles translation rules to lowercase and sorts by descending length for longest-match.
   * @param translations - Raw TranslationRule array from the config.
   * @returns Array of CompiledRule objects sorted longest-first.
   */
  private compileRules(translations: TranslationRule[]): CompiledRule[] {
    return translations
      .map(t => ({ fromLower: t.fromPayee.toLowerCase(), toPayee: t.toPayee }))
      .sort((a, b) => b.fromLower.length - a.fromLower.length);
  }
}
