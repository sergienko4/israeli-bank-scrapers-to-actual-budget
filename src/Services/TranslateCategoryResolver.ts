/**
 * Translation-based category resolver
 * Maps Hebrew payee names to English using fromPayee/toPayee rules.
 * Longest match wins — "שופרסל" matches before "סופר".
 */

import { getLogger } from '../Logger/Index.js';
import type { IResolvedCategory,ITranslationRule, Procedure } from '../Types/Index.js';
import { fail, succeed } from '../Types/Index.js';
import type { ICategoryResolver } from './ICategoryResolver.js';

interface ICompiledRule {
  fromLower: string;
  toPayee: string;
}

/** Resolves transaction payee names by matching Hebrew text against translation rules. */
export default class TranslateCategoryResolver implements ICategoryResolver {
  private readonly _rules: ICompiledRule[];

  /**
   * Creates a TranslateCategoryResolver by pre-compiling the given translation rules.
   * @param translations - Array of ITranslationRule objects defining fromPayee->toPayee mappings.
   */
  constructor(translations: ITranslationRule[]) {
    this._rules = TranslateCategoryResolver.compileRules(translations);
  }

  /**
   * Logs the number of loaded translation rules and returns a resolved promise.
   * @returns Resolved promise (no async work needed).
   */
  public initialize(): Promise<Procedure<{ status: string }>> {
    getLogger().info(
      `  📂 Payee translations loaded: ${String(this._rules.length)} rules`
    );
    const result = succeed({ status: 'initialized' });
    return Promise.resolve(result);
  }

  /**
   * Finds the first translation rule matching the given payee description.
   * @param description - The raw transaction payee or description string.
   * @returns IResolvedCategory with the translated payee name, or undefined if no match.
   */
  public resolve(description: string): Procedure<IResolvedCategory> {
    const lower = description.toLowerCase();
    const match = this._rules.find(rule => lower.includes(rule.fromLower));
    if (!match) return fail(`no translation match for "${description}"`);
    return succeed({ payeeName: match.toPayee, importedPayee: description });
  }

  /**
   * Pre-compiles translation rules to lowercase and sorts by descending length for longest-match.
   * @param translations - Raw ITranslationRule array from the config.
   * @returns Array of ICompiledRule objects sorted longest-first.
   */
  private static compileRules(translations: ITranslationRule[]): ICompiledRule[] {
    return translations
      .map(t => ({ fromLower: t.fromPayee.toLowerCase(), toPayee: t.toPayee }))
      .sort((a, b) => b.fromLower.length - a.fromLower.length);
  }
}
