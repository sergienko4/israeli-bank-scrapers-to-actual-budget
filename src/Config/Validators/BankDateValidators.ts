/**
 * Validators for per-bank date-config fields (daysBack, startDate).
 *
 * Iterated by `validateDateConfig` in `ConfigLoaderValidator.ts` instead of
 * the legacy `if (config.daysBack !== undefined)` / `if (config.startDate)`
 * pair, which the coupling scanner counted as an OCP risk in the parent file.
 *
 * Unlike top-level block validators, bank-date validators need both the
 * bank name (for error messages) and the bank's config, so the registry
 * is typed against a small {@link IBankDateContext} tuple.
 */
import type { IBankConfig, Procedure } from '../../Types/Index.js';
import { fail, succeed } from '../../Types/Index.js';
import type { IBlockValidator } from './IBlockValidator.js';

/** Tuple passed to bank-date validators carrying both the bank name and its config. */
export interface IBankDateContext {
  /** Bank key from the banks map, used in error messages. */
  readonly bankName: string;
  /** The IBankConfig whose date fields are being validated. */
  readonly config: IBankConfig;
}

/**
 * Returns a Date representing exactly one year before today.
 * @returns Date object set to one year ago.
 */
function getOneYearAgo(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d;
}

/**
 * Validates that daysBack is an integer between 1 and 30.
 * @param bankName - Bank name used in error messages.
 * @param daysBack - The daysBack value to validate.
 * @returns Procedure success when value is in range.
 */
function validateDaysBack(bankName: string, daysBack: number): Procedure<{ valid: true }> {
  if (!Number.isInteger(daysBack) || daysBack < 1 || daysBack > 30) {
    return fail(
      `${bankName}: "daysBack" must be an integer between 1 and 30. Got: ${String(daysBack)}`
    );
  }
  return succeed({ valid: true as const });
}

/**
 * Validates that a startDate is neither in the future nor older than one year.
 * @param bankName - Bank name used in error messages.
 * @param startDate - The startDate string (YYYY-MM-DD); re-parsed for the range comparison.
 * @returns Procedure success when the date is within the allowed range.
 */
function checkDateRange(bankName: string, startDate: string): Procedure<{ valid: true }> {
  const date = new Date(startDate);
  if (date > new Date()) {
    return fail(`startDate cannot be in the future for ${bankName}. Got: ${startDate}`);
  }
  if (date < getOneYearAgo()) {
    return fail(`${bankName}: startDate too old (>1 year). Got: ${startDate}`);
  }
  return succeed({ valid: true as const });
}

/**
 * Validates startDate format, ensures it is not in the future, and not older than one year.
 * @param bankName - Bank name used in error messages.
 * @param startDate - The startDate string (YYYY-MM-DD) to validate.
 * @returns Procedure success on valid date, else failure message.
 */
function validateStartDate(bankName: string, startDate: string): Procedure<{ valid: true }> {
  const date = new Date(startDate);
  const dateTimestamp = date.getTime();
  if (Number.isNaN(dateTimestamp)) {
    return fail(`Invalid startDate for ${bankName}: "${startDate}". Use YYYY-MM-DD`);
  }
  return checkDateRange(bankName, startDate);
}

const DAYS_BACK_VALIDATOR: IBlockValidator<IBankDateContext> = {
  name: 'daysBack',
  /**
   * Decides whether the daysBack field should be validated.
   * @param ctx - Bank-date context (bankName + config).
   * @returns True if `ctx.config.daysBack` is defined.
   */
  applies(ctx: IBankDateContext): boolean {
    return ctx.config.daysBack !== undefined;
  },
  /**
   * Validates daysBack when present.
   * @param ctx - Bank-date context (bankName + config).
   * @returns Procedure success when field is absent or valid, else failure.
   */
  validate(ctx: IBankDateContext): Procedure<{ valid: true }> {
    const days = ctx.config.daysBack;
    if (days === undefined) return succeed({ valid: true as const });
    return validateDaysBack(ctx.bankName, days);
  },
};

const START_DATE_VALIDATOR: IBlockValidator<IBankDateContext> = {
  name: 'startDate',
  /**
   * Decides whether the startDate field should be validated.
   * @param ctx - Bank-date context (bankName + config).
   * @returns True if `ctx.config.startDate` is truthy.
   */
  applies(ctx: IBankDateContext): boolean {
    return Boolean(ctx.config.startDate);
  },
  /**
   * Validates startDate when present.
   * @param ctx - Bank-date context (bankName + config).
   * @returns Procedure success when field is absent or valid, else failure.
   */
  validate(ctx: IBankDateContext): Procedure<{ valid: true }> {
    const startDate = ctx.config.startDate;
    if (!startDate) return succeed({ valid: true as const });
    return validateStartDate(ctx.bankName, startDate);
  },
};

/**
 * Registry of per-bank date-field validators iterated by validateDateConfig.
 *
 * Legacy order preserved (daysBack → startDate). Mutual-exclusion check
 * (both set) is performed by validateDateConfig BEFORE the loop, so any
 * combination that reaches the loop has at most one applicable validator.
 */
export const BANK_DATE_VALIDATORS: readonly IBlockValidator<IBankDateContext>[] = [
  DAYS_BACK_VALIDATOR,
  START_DATE_VALIDATOR,
];
