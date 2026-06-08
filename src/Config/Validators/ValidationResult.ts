/**
 * Shared result type + factory helpers for ConfigValidator checks.
 *
 * Extracted from `ConfigValidator.ts` (PR 3 of the decoupling plan) so the
 * top-level validator class stays a thin orchestrator. Every offline /
 * online checker module imports the factories from here, keeping the
 * result shape and labels in one place.
 */

/** A single check result from config validation. */
export interface IValidationResult {
  /** Whether the check passed, failed, or produced a warning. */
  status: 'pass' | 'fail' | 'warn';
  /** Dotted path identifying the config field checked (e.g. `bank.discount.target[0]`). */
  check: string;
  /** Human-readable description of the result. */
  message: string;
}

/**
 * Creates a passing IValidationResult.
 * @param check - Dotted path of the config field checked.
 * @param message - Description of the passing check.
 * @returns A IValidationResult with status 'pass'.
 */
export function pass(check: string, message: string): IValidationResult {
  return { status: 'pass', check, message };
}

/**
 * Creates a failing IValidationResult.
 * @param check - Dotted path of the config field checked.
 * @param message - Description of the failure.
 * @returns A IValidationResult with status 'fail'.
 */
export function fail(check: string, message: string): IValidationResult {
  return { status: 'fail', check, message };
}

/**
 * Creates a warning IValidationResult.
 * @param check - Dotted path of the config field checked.
 * @param message - Description of the warning.
 * @returns A IValidationResult with status 'warn'.
 */
export function warn(check: string, message: string): IValidationResult {
  return { status: 'warn', check, message };
}

/**
 * Checks whether a string matches the standard UUID format.
 *
 * Used by both `ActualOfflineChecker` (syncId) and `BanksOfflineChecker`
 * (target.actualAccountId), so it lives next to the result helpers
 * rather than duplicated in each.
 *
 * @param s - The string to test.
 * @returns True if the string is a valid UUID.
 */
export function isValidUUID(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
