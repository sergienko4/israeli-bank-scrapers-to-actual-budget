/**
 * Offline checks for the banks configuration section.
 *
 * Extracted from `ConfigValidator.ts` (PR 3 of the decoupling plan).
 *
 * Also owns the `KNOWN_BANKS` derived set and the Levenshtein-based
 * `suggest` helper, since both are used only by the bank-name check
 * and previously caused fan-in into `ConfigValidator.ts`.
 */
import { CompanyTypes } from '@sergienko4/israeli-bank-scrapers';

import type { IBankConfig, IBankTarget } from '../../Types/Index.js';
import {
  fail, isValidUUID, type IValidationResult,
pass, warn, } from './ValidationResult.js';

export type { IValidationResult } from './ValidationResult.js';

const KNOWN_BANKS = new Set(Object.keys(CompanyTypes).map(k => k.toLowerCase()));

/**
 * Computes the Levenshtein edit distance between two strings.
 * @param a - First string to compare.
 * @param b - Second string to compare.
 * @returns Integer edit distance between a and b.
 */
function levenshtein(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next: number[] = Array.from({ length: b.length + 1 }, () => 0);
    next[0] = i;
    for (let j = 1; j <= b.length; j++)
      next[j] = a[i - 1] === b[j - 1] ? row[j - 1]
        : 1 + Math.min(row[j], next[j - 1], row[j - 1]);
    row = next;
  }
  return row[b.length];
}

/**
 * Finds the closest known bank name to the given input, if within edit distance 4.
 * @param name - Lowercased bank name entered by the user.
 * @returns The closest matching known bank name, or empty string if no close match.
 */
function suggest(name: string): string {
  let best = '';
  let bestDist = 4;
  for (const bank of KNOWN_BANKS) {
    const d = levenshtein(name, bank);
    if (d < bestDist) { bestDist = d; best = bank; }
  }
  return best;
}

/**
 * Checks whether the bank name is a known institution, with typo suggestions.
 * @param name - The bank key to validate against KNOWN_BANKS.
 * @returns A pass result if known, otherwise fail with an optional suggestion.
 */
function checkBankName(name: string): IValidationResult {
  const lowerName = name.toLowerCase();
  if (KNOWN_BANKS.has(lowerName)) {
    return pass(`bank.${name}`, `Bank "${name}" — known institution`);
  }
  const suggestion = suggest(lowerName);
  const hint = suggestion ? ` Did you mean "${suggestion}"?` : '';
  return fail(`bank.${name}`, `Bank "${name}" — unknown institution.${hint}`);
}

/**
 * Validates that startDate and daysBack are not both set for a bank.
 * @param name - Bank key used in result messages.
 * @param cfg - The IBankConfig whose date fields to check.
 * @returns Array containing a single IValidationResult for the date config.
 */
function checkBankDates(name: string, cfg: IBankConfig): IValidationResult[] {
  if (cfg.startDate && cfg.daysBack) {
    return [fail(`bank.${name}.dates`,
      `${name}: cannot use both "startDate" and "daysBack" — choose one`)];
  }
  if (!cfg.startDate && !cfg.daysBack) {
    return [warn(`bank.${name}.dates`,
      `${name}: no daysBack/startDate set — will fetch ~1 year of history`)];
  }
  return [pass(`bank.${name}.dates`, `${name}: date config valid`)];
}

/**
 * Validates a single bank target's actualAccountId format and accounts field.
 * @param name - Bank key used in result messages.
 * @param target - The IBankTarget to check.
 * @param idx - Zero-based target index used in result labels.
 * @returns A IValidationResult for this target.
 */
function checkBankTarget(
  name: string, target: IBankTarget, idx: number
): IValidationResult {
  const id = target.actualAccountId;
  const tag = `bank.${name}.target[${String(idx)}]`;
  if (!id || !isValidUUID(id)) {
    const idLabel = id || '(empty)';
    return fail(tag,
      `${name} target[${String(idx)}]: invalid actualAccountId "${idLabel}" — expected UUID`);
  }
  const label = target.accountName ?? `...${id.split('-').at(-1) ?? ''}`;
  const accts = Array.isArray(target.accounts) ? `[${target.accounts.join(', ')}]` : target.accounts;
  const rec = String(target.reconcile);
  return pass(tag,
    `${name} target[${String(idx)}] "${label}": accounts=${accts}, reconcile=${rec}`);
}

/**
 * Validates that at least one target is configured and each target is valid.
 * @param name - Bank key used in result messages.
 * @param cfg - The IBankConfig whose targets to check.
 * @returns Array of IValidationResult objects, one per target.
 */
function checkBankTargets(name: string, cfg: IBankConfig): IValidationResult[] {
  if (!cfg.targets || cfg.targets.length === 0) {
    return [fail(`bank.${name}.targets`, `${name}: no targets configured`)];
  }
  return cfg.targets.map((t, i) => checkBankTarget(name, t, i));
}

/**
 * Runs all offline checks for a single bank entry.
 * @param name - The bank key from the banks map.
 * @param cfg - The IBankConfig to validate.
 * @returns Array of IValidationResult objects for name, dates, and targets.
 */
function checkBankOffline(name: string, cfg: IBankConfig): IValidationResult[] {
  return [
    checkBankName(name),
    ...checkBankDates(name, cfg),
    ...checkBankTargets(name, cfg),
  ];
}

/**
 * Checks that at least one bank is configured and validates each one offline.
 * @param banks - The banks map from the IImporterConfig.
 * @returns Array of IValidationResult objects for all configured banks.
 */
export function checkBanksOffline(banks: Record<string, IBankConfig>): IValidationResult[] {
  if (Object.keys(banks).length === 0) {
    return [fail('banks', 'No banks configured')];
  }
  return Object.entries(banks)
    .flatMap(([name, cfg]) => checkBankOffline(name, cfg));
}
