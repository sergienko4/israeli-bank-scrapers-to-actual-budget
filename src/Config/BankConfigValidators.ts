/**
 * Per-bank config validation: date settings, targets, and credential field formats.
 *
 * Extracted from {@link ./ConfigLoaderValidator.js} to keep each module within the
 * size budget; `validateBank` is re-exported from `ConfigLoaderValidator.js` so existing
 * importers keep their import paths unchanged. All functions return
 * Procedure<{ valid: true }> — succeed if OK, fail with an error message.
 */
import type { IBankConfig, Procedure } from '../Types/Index.js';
import { fail, isFail, succeed } from '../Types/Index.js';
import { CREDENTIAL_SPECS } from './BankCredentialSpecs.js';
import { BANK_DATE_VALIDATORS } from './Validators/BankDateValidators.js';
import { isValidUUID } from './Validators/ValidationResult.js';

// Email format: non-empty local part, "@", domain, and a dotted TLD, no spaces.
const EMAIL_RE = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/;

/**
 * Type guard: validates config is a non-null object at runtime.
 * Defensive check despite IBankConfig typing - external JSON may be malformed.
 * @param config - The value to check.
 * @returns True if config is a non-null object.
 */
function isValidConfigObject(config: unknown): config is Record<string, unknown> {
  return config !== null && typeof config === 'object';
}

/**
 * Validates all settings for a single bank entry.
 * @param bankName - The key used for this bank in the banks map.
 * @param config - The IBankConfig object to validate.
 * @returns Procedure with valid: true on success, or failure message.
 */
export default function validateBank(
  bankName: string, config: IBankConfig
): Procedure<{ valid: true }> {
  if (!isValidConfigObject(config)) {
    return fail(`${bankName}: config must be a non-null object`);
  }
  const dateResult = validateDateConfig(bankName, config);
  if (isFail(dateResult)) return dateResult;
  const targetsResult = validateTargets(bankName, config.targets);
  if (isFail(targetsResult)) return targetsResult;
  const credResult = validateBankCredentials(bankName, config);
  if (isFail(credResult)) return credResult;
  return succeed({ valid: true as const });
}

/**
 * Validates that only one of startDate or daysBack is set, and their values are in range.
 * @param bankName - Bank name used in error messages.
 * @param config - The bank config containing the date settings.
 * @returns Procedure with valid: true on success, or failure message.
 */
function validateDateConfig(bankName: string, config: IBankConfig): Procedure<{ valid: true }> {
  if (config.startDate && config.daysBack) {
    return fail(
      `${bankName}: cannot use both "startDate" and "daysBack". Choose one.`
    );
  }
  const ctx = { bankName, config };
  for (const validator of BANK_DATE_VALIDATORS) {
    if (!validator.applies(ctx)) continue;
    const result = validator.validate(ctx);
    if (isFail(result)) return result;
  }
  return succeed({ valid: true as const });
}

/**
 * Validates that at least one target is configured and each target is valid.
 * @param bankName - Bank name used in error messages.
 * @param targets - The array of IBankTarget objects to validate.
 * @returns Procedure with valid: true on success, or failure message.
 */
function validateTargets(
  bankName: string, targets: IBankConfig['targets']
): Procedure<{ valid: true }> {
  if (!Array.isArray(targets) || targets.length === 0) {
    return fail(
      `No targets configured for ${bankName}. At least one target is required.`
    );
  }
  for (let idx = 0; idx < targets.length; idx++) {
    const target: unknown = targets[idx];
    if (target === null || typeof target !== 'object' || Array.isArray(target)) {
      return fail(`Invalid target for ${bankName} target ${String(idx)}. Must be an object.`);
    }
    const targetResult = validateTarget(
      bankName, target as Parameters<typeof validateTarget>[1], idx
    );
    if (isFail(targetResult)) return targetResult;
  }
  return succeed({ valid: true as const });
}

/**
 * Validates that a target's actualAccountId is present and is a valid UUID.
 * @param bankName - Bank name used in error messages.
 * @param accountId - The actualAccountId string to validate.
 * @param idx - Zero-based target index used in error messages.
 * @returns Procedure with valid: true on success, or failure message.
 */
function validateTargetId(
  bankName: string, accountId: string, idx: number
): Procedure<{ valid: true }> {
  if (typeof accountId !== 'string' || !accountId) {
    return fail(`Missing actualAccountId for ${bankName} target ${String(idx)}`);
  }
  if (!isValidUUID(accountId)) {
    return fail(
      `Invalid actualAccountId format for ${bankName} target ${String(idx)}.\n` +
      '  Expected: UUID format (e.g., "12345678-1234-1234-1234-123456789abc")\n' +
      `  Got: "${accountId}"`
    );
  }
  return succeed({ valid: true as const });
}

/**
 * Validates a single IBankTarget: ID, accounts field, and reconcile type.
 * @param bankName - Bank name used in error messages.
 * @param target - The target object to validate.
 * @param target.actualAccountId - UUID of the Actual account.
 * @param target.accounts - Account filter: 'all' or array of account numbers.
 * @param target.reconcile - Whether reconciliation is enabled.
 * @param idx - Zero-based target index used in error messages.
 * @returns Procedure with valid: true on success, or failure message.
 */
function validateTarget(
  bankName: string,
  target: { actualAccountId: string; accounts: string[] | 'all'; reconcile: boolean },
  idx: number
): Procedure<{ valid: true }> {
  const idResult = validateTargetId(bankName, target.actualAccountId, idx);
  if (isFail(idResult)) return idResult;
  const { accounts } = target;
  if (accounts !== 'all' && (!Array.isArray(accounts) || accounts.length === 0 ||
    ![...accounts].every((account: unknown) => typeof account === 'string'))) {
    return fail(
      `Invalid accounts for ${bankName} target ${String(idx)}. Must be "all" or array of strings.`
    );
  }
  if (typeof target.reconcile !== 'boolean') {
    return fail(`Invalid reconcile for ${bankName} target ${String(idx)}. Must be boolean.`);
  }
  return succeed({ valid: true as const });
}

/**
 * Validates credential field formats and required credential presence for a bank.
 * @param bankName - The bank key used to look up the credential spec.
 * @param config - The IBankConfig whose credentials to validate.
 * @returns Procedure with valid: true on success, or failure message.
 */
function validateBankCredentials(
  bankName: string, config: IBankConfig
): Procedure<{ valid: true }> {
  const formatsResult = validateFieldFormats(bankName, config);
  if (isFail(formatsResult)) return formatsResult;
  const requiredResult = validateRequiredCredentials(bankName, config);
  if (isFail(requiredResult)) return requiredResult;
  return succeed({ valid: true as const });
}

/**
 * Validates email, phone number, and card6Digits format for a bank config.
 * @param bankName - Bank name used in error messages.
 * @param config - The IBankConfig whose field formats to validate.
 * @returns Procedure with valid: true on success, or failure message.
 */
function validateFieldFormats(
  bankName: string, config: IBankConfig
): Procedure<{ valid: true }> {
  if (config.email &&
      (typeof config.email !== 'string' || !EMAIL_RE.test(config.email))) {
    return fail(`Invalid email format for ${bankName}: "${config.email}"`);
  }
  const phone = typeof config.phoneNumber === 'string'
    ? config.phoneNumber.replaceAll(/[\s-]/g, '') : '';
  if (config.phoneNumber && !/^\+?\d{10,15}$/.test(phone)) {
    return fail(`Invalid phone number format for ${bankName}: "${config.phoneNumber}".`);
  }
  if (config.card6Digits &&
      (typeof config.card6Digits !== 'string' || !/^\d{6}$/.test(config.card6Digits))) {
    return fail(`Invalid card6Digits format for ${bankName}: "${config.card6Digits}".`);
  }
  return succeed({ valid: true as const });
}

/**
 * Checks that all required credential fields are present for known banks.
 * @param bankName - The bank key to look up in the credential spec map.
 * @param config - The IBankConfig to check for required fields.
 * @returns Procedure with valid: true on success, or failure message.
 */
function validateRequiredCredentials(
  bankName: string, config: IBankConfig
): Procedure<{ valid: true }> {
  const key = bankName.toLowerCase();
  if (!Object.hasOwn(CREDENTIAL_SPECS, key)) return succeed({ valid: true as const });
  const spec = CREDENTIAL_SPECS[key];
  const missing = spec.required.filter(field => !config[field]);
  if (missing.length > 0) {
    return fail(`${spec.displayName} requires: ${spec.label}`);
  }
  return succeed({ valid: true as const });
}
