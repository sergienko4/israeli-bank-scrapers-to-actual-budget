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
 * Computes the next Levenshtein matrix row from the previous row.
 * @param prev - The previous matrix row (index 0 holds the prior row number).
 * @param ca - The current character from the first string.
 * @param b - The second string being compared against.
 * @returns The next matrix row.
 */
function nextLevRow(prev: number[], ca: string, b: string): number[] {
  const next: number[] = [prev[0] + 1];
  for (let j = 1; j <= b.length; j++)
    next[j] = ca === b[j - 1] ? prev[j - 1]
      : 1 + Math.min(prev[j], next[j - 1], prev[j - 1]);
  return next;
}

/**
 * Computes the Levenshtein edit distance between two strings.
 * @param a - First string to compare.
 * @param b - Second string to compare.
 * @returns Integer edit distance between a and b.
 */
function levenshtein(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++)
    row = nextLevRow(row, a[i - 1], b);
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
 * Builds the "both startDate and daysBack set" failure result.
 * @param name - Bank key used in the result message.
 * @returns A fail IValidationResult.
 */
function bothDatesSet(name: string): IValidationResult {
  return fail(`bank.${name}.dates`,
    `${name}: cannot use both "startDate" and "daysBack" — choose one`);
}

/**
 * Builds the "neither startDate nor daysBack set" warning result.
 * @param name - Bank key used in the result message.
 * @returns A warn IValidationResult.
 */
function noDatesSet(name: string): IValidationResult {
  return warn(`bank.${name}.dates`,
    `${name}: no daysBack/startDate set — will fetch ~1 year of history`);
}

/**
 * Validates that startDate and daysBack are not both set for a bank.
 * @param name - Bank key used in result messages.
 * @param cfg - The IBankConfig whose date fields to check.
 * @returns Array containing a single IValidationResult for the date config.
 */
function checkBankDates(name: string, cfg: IBankConfig): IValidationResult[] {
  const hasStart = typeof cfg.startDate === 'string' && cfg.startDate.length > 0;
  const hasDays = typeof cfg.daysBack === 'number';
  if (hasStart && hasDays) return [bothDatesSet(name)];
  if (!hasStart && !hasDays) return [noDatesSet(name)];
  return [pass(`bank.${name}.dates`, `${name}: date config valid`)];
}

/**
 * Formats the human-readable summary for a valid bank target.
 * @param target - The IBankTarget whose label, accounts and reconcile flag to render.
 * @param idx - Zero-based target index.
 * @returns Formatted string like `target[0] "Main": accounts=[...], reconcile=true`.
 */
function formatTargetSummary(target: IBankTarget, idx: number): string {
  const label = target.accountName ?? `...${target.actualAccountId.split('-').at(-1) ?? ''}`;
  const accts = Array.isArray(target.accounts) ? `[${target.accounts.join(', ')}]` : target.accounts;
  const rec = String(target.reconcile);
  return `target[${String(idx)}] "${label}": accounts=${accts}, reconcile=${rec}`;
}

/**
 * Builds the invalid-actualAccountId failure result.
 * @param name - Bank key used in result messages.
 * @param idx - Zero-based target index used in result labels.
 * @param id - The actualAccountId that failed validation.
 * @returns A fail result describing the invalid actualAccountId.
 */
function invalidTargetId(name: string, idx: number, id: string): IValidationResult {
  const idLabel = id || '(empty)';
  const tag = `bank.${name}.target[${String(idx)}]`;
  return fail(tag,
    `${name} target[${String(idx)}]: invalid actualAccountId "${idLabel}" — expected UUID`);
}

/**
 * Reports whether an accounts filter is the 'all' sentinel or a non-empty list
 * of non-blank strings — the shape the importer's strict loader and the portal
 * normalization path both require, so a hand-edited config cannot smuggle in a
 * whitespace-only account id the writer would have stripped.
 * @param accounts - The target's accounts value.
 * @returns True when accounts is 'all' or a non-empty array of non-blank strings.
 */
function isValidAccounts(accounts: unknown): boolean {
  if (accounts === 'all') return true;
  return Array.isArray(accounts) && accounts.length > 0
    && accounts.every(account => typeof account === 'string' && account.trim() !== '');
}

/**
 * Builds the invalid-accounts failure result for a bank target.
 * @param name - Bank key used in the message.
 * @param idx - Zero-based target index used in result labels.
 * @param tag - Result tag for the target.
 * @returns A fail result describing the invalid accounts shape.
 */
function invalidTargetAccounts(name: string, idx: number, tag: string): IValidationResult {
  return fail(tag,
    `${name} target[${String(idx)}]: invalid accounts — must be "all" or account numbers`);
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
  if (!id || !isValidUUID(id)) return invalidTargetId(name, idx, id);
  const tag = `bank.${name}.target[${String(idx)}]`;
  if (!isValidAccounts(target.accounts)) return invalidTargetAccounts(name, idx, tag);
  return pass(tag, `${name} ${formatTargetSummary(target, idx)}`);
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
