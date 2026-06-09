/**
 * Offline checks for the Actual Budget configuration section.
 *
 * Extracted from `ConfigValidator.ts` (PR 3 of the decoupling plan) so each
 * top-level config block has its own checker module. Returns
 * IValidationResult[] instead of throwing so callers can surface every
 * issue at once.
 */
import type { IImporterConfig } from '../../Types/Index.js';
import {
  fail, isValidUUID, type IValidationResult,
pass, } from './ValidationResult.js';

export type { IValidationResult } from './ValidationResult.js';

/**
 * Checks whether the Actual Budget password is set.
 * @param config - The IImporterConfig to inspect.
 * @returns A pass result if the password is present, otherwise fail.
 */
function checkActualPassword(config: IImporterConfig): IValidationResult {
  return config.actual.init.password
    ? pass('actual.password', 'Actual password is set')
    : fail('actual.password', 'ACTUAL_PASSWORD is missing');
}

/**
 * Checks whether the Actual Budget syncId is a valid UUID.
 * @param config - The IImporterConfig to inspect.
 * @returns A pass result if the syncId is a valid UUID, otherwise fail.
 */
function checkActualSyncId(config: IImporterConfig): IValidationResult {
  const { syncId } = config.actual.budget;
  return isValidUUID(syncId)
    ? pass('actual.syncId', 'syncId UUID format valid')
    : fail('actual.syncId', `Invalid syncId: "${syncId}" — expected UUID format`);
}

/**
 * Checks whether the Actual server URL is present and starts with http.
 * @param config - The IImporterConfig to inspect.
 * @returns A pass result if the URL is valid, otherwise fail.
 */
function checkActualServerUrl(config: IImporterConfig): IValidationResult {
  const { serverURL } = config.actual.init;
  if (!serverURL) return fail('actual.serverURL', 'serverURL is missing');
  return serverURL.startsWith('http')
    ? pass('actual.serverURL', `Server URL format valid: ${serverURL}`)
    : fail('actual.serverURL',
      `Invalid serverURL "${serverURL}" — must start with http://`);
}

/**
 * Runs offline checks for the Actual Budget configuration section.
 * @param config - The IImporterConfig whose actual block to check.
 * @returns Array of IValidationResult objects for password, syncId, and serverURL.
 */
export function checkActualOffline(config: IImporterConfig): IValidationResult[] {
  return [
    checkActualPassword(config),
    checkActualSyncId(config),
    checkActualServerUrl(config),
  ];
}
