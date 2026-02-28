/**
 * Translation-based category resolver
 * Maps Hebrew payee names to English using fromPayee/toPayee rules.
 * Longest match wins — "שופרסל" matches before "סופר".
 */

import { TranslationRule, ResolvedCategory } from '../types/index.js';
import { ICategoryResolver } from './ICategoryResolver.js';
import { getLogger } from '../logger/index.js';

interface CompiledRule {
  fromLower: string;
  toPayee: string;
}

export class TranslateCategoryResolver implements ICategoryResolver {
  private rules: CompiledRule[];

  constructor(translations: TranslationRule[]) {
    this.rules = this.compileRules(translations);
  }

  initialize(): Promise<void> {
    getLogger().info(`  📂 Payee translations loaded: ${this.rules.length} rules`);
    return Promise.resolve();
  }

  resolve(description: string): ResolvedCategory | undefined {
    const lower = description.toLowerCase();
    const match = this.rules.find(r => lower.includes(r.fromLower));
    if (!match) return undefined;
    return { payeeName: match.toPayee, importedPayee: description };
  }

  private compileRules(translations: TranslationRule[]): CompiledRule[] {
    return translations
      .map(t => ({ fromLower: t.fromPayee.toLowerCase(), toPayee: t.toPayee }))
      .sort((a, b) => b.fromLower.length - a.fromLower.length);
  }
}
