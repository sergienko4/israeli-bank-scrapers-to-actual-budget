/**
 * Config-bound helpers for the Telegram scheduler wiring.
 *
 * Both getConfiguredBankNames and runConfigValidation are pure-ish bridges
 * between live config state and the wiring layer. Kept in their own module
 * so mediator + handler factories can depend on them without pulling in
 * the rest of the Telegram orchestration surface.
 */

import type * as ConfigValidatorModule from '../../Config/ConfigValidator.js';
import { getLogger } from '../../Logger/Index.js';
import { loadFullConfig } from '../ConfigBootstrap.js';

/**
 * Returns all configured bank names from the live config.
 *
 * Single source of truth used by both the mediator and the command handler.
 *
 * @returns Array of bank name strings (empty array if config cannot be loaded).
 */
export function getConfiguredBankNames(): string[] {
  const cfg = loadFullConfig();
  if (!cfg.success) {
    getLogger().warn(`getBankNames: config load failed — ${cfg.message}`);
    return [];
  }
  return Object.keys(cfg.data.banks);
}

/**
 * Lazily loads ConfigValidator module.
 *
 * @returns The ConfigValidator module namespace.
 */
async function loadValidationDeps(): Promise<{
  configValidatorModule: typeof ConfigValidatorModule;
}> {
  const configValidatorModule = await import('../../Config/ConfigValidator.js');
  return { configValidatorModule };
}

/**
 * Runs all validation checks on the live config.
 *
 * Uses loadFullConfig (already imported from ConfigBootstrap) for config loading,
 * eliminating the need for a dynamic ConfigLoader import. ConfigValidator is still
 * lazily imported to minimise the blast radius.
 *
 * @returns Formatted validation report string for display in Telegram.
 */
export async function runConfigValidation(): Promise<string> {
  const rawResult = loadFullConfig();
  if (!rawResult.success) {
    return `[FAIL] Cannot load config: ${rawResult.message}`;
  }
  const { configValidatorModule } = await loadValidationDeps();
  const validator = new configValidatorModule.ConfigValidator();
  const results = await validator.validateAll(rawResult.data);
  return configValidatorModule.ConfigValidator.formatReport(results);
}
