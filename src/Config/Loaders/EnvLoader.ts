/**
 * Builds IImporterConfig + IBankConfig entries from environment variables.
 *
 * Used by ConfigLoader when no config.json is present. Reads ACTUAL_* env
 * vars for the Actual budget connection, and per-bank env vars for credentials
 * (DISCOUNT_*, LEUMI_*, HAPOALIM_*).
 */

import type { IBankConfig, IBankTarget, IImporterConfig, Procedure } from '../../Types/Index.js';
import { fail, isSuccess, succeed } from '../../Types/Index.js';

/**
 * Builds a single IBankTarget from <prefix>_ACCOUNT_ID / <prefix>_ACCOUNTS / <prefix>_RECONCILE.
 *
 * @param prefix - Env var prefix (e.g. "DISCOUNT") used to look up account settings.
 * @returns Array containing one IBankTarget derived from the env vars.
 */
function buildTargetFromEnv(prefix: string): IBankTarget[] {
  const accounts = process.env[`${prefix}_ACCOUNTS`] || 'all';
  return [{
    actualAccountId: process.env[`${prefix}_ACCOUNT_ID`] || '',
    reconcile: process.env[`${prefix}_RECONCILE`] === 'true',
    accounts: accounts === 'all' ? 'all' : accounts.split(',')
  }];
}

/**
 * Builds a Discount bank config from env vars when DISCOUNT_ID is set.
 *
 * @returns Procedure containing the IBankConfig, or fail when the marker env var is absent.
 */
function discountFromEnv(): Procedure<IBankConfig> {
  if (!process.env.DISCOUNT_ID) return fail('DISCOUNT_ID not set');
  return succeed({
    id: process.env.DISCOUNT_ID, password: process.env.DISCOUNT_PASSWORD,
    num: process.env.DISCOUNT_NUM, startDate: process.env.DISCOUNT_START_DATE,
    targets: buildTargetFromEnv('DISCOUNT')
  });
}

/**
 * Builds a Leumi bank config from env vars when LEUMI_USERNAME is set.
 *
 * @returns Procedure containing the IBankConfig, or fail when the marker env var is absent.
 */
function leumiFromEnv(): Procedure<IBankConfig> {
  if (!process.env.LEUMI_USERNAME) return fail('LEUMI_USERNAME not set');
  return succeed({
    username: process.env.LEUMI_USERNAME, password: process.env.LEUMI_PASSWORD,
    startDate: process.env.LEUMI_START_DATE, targets: buildTargetFromEnv('LEUMI')
  });
}

/**
 * Builds a Hapoalim bank config from env vars when HAPOALIM_USER_CODE is set.
 *
 * @returns Procedure containing the IBankConfig, or fail when the marker env var is absent.
 */
function hapoalimFromEnv(): Procedure<IBankConfig> {
  if (!process.env.HAPOALIM_USER_CODE) return fail('HAPOALIM_USER_CODE not set');
  return succeed({
    userCode: process.env.HAPOALIM_USER_CODE, password: process.env.HAPOALIM_PASSWORD,
    startDate: process.env.HAPOALIM_START_DATE, targets: buildTargetFromEnv('HAPOALIM')
  });
}

/**
 * Bank loaders keyed by their banks-map insertion name.
 *
 * Adding a new bank only requires appending an entry here — loadFromEnvironment
 * loops the entries and inserts each successful result into config.banks.
 */
const BANK_LOADERS: readonly (readonly [string, () => Procedure<IBankConfig>])[] = [
  ['discount', discountFromEnv],
  ['leumi', leumiFromEnv],
  ['hapoalim', hapoalimFromEnv],
];

/**
 * Builds the `actual` block of IImporterConfig from ACTUAL_* env vars.
 *
 * @returns The actual sub-object with defaults applied for unset env vars.
 */
function buildActualFromEnv(): IImporterConfig['actual'] {
  return {
    init: {
      dataDir: process.env.ACTUAL_DATA_DIR || './data',
      password: process.env.ACTUAL_PASSWORD || '',
      serverURL: process.env.ACTUAL_SERVER_URL || 'http://actual_server:5006'
    },
    budget: {
      syncId: process.env.ACTUAL_BUDGET_SYNC_ID || '',
      password: process.env.ACTUAL_BUDGET_PASSWORD || null
    }
  };
}

/**
 * Builds the `banks` map by iterating BANK_LOADERS and inserting successes.
 *
 * @returns A map of bank name to IBankConfig for every loader whose marker env var was set.
 */
function buildBanksFromEnv(): Record<string, IBankConfig> {
  const banks: Record<string, IBankConfig> = {};
  for (const [name, loader] of BANK_LOADERS) {
    const result = loader();
    if (isSuccess(result)) banks[name] = result.data;
  }
  return banks;
}

/**
 * Builds a minimal IImporterConfig from environment variables.
 *
 * Reads ACTUAL_* for the Actual budget connection, and per-bank env vars
 * (DISCOUNT_*, LEUMI_*, HAPOALIM_*) for credentials. Banks whose marker
 * env var is absent are simply omitted from the resulting `banks` map.
 *
 * @returns An IImporterConfig populated from environment variables.
 */
export default function loadFromEnvironment(): IImporterConfig {
  return { actual: buildActualFromEnv(), banks: buildBanksFromEnv() };
}

