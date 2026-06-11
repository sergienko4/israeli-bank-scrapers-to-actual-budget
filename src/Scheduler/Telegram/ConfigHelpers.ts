/**
 * Config-bound helpers for the Telegram scheduler wiring.
 *
 * Both getConfiguredBankNames and runConfigValidation are pure-ish bridges
 * between live config state and the wiring layer. Kept in their own module
 * so mediator + handler factories can depend on them without pulling in
 * the rest of the Telegram orchestration surface.
 */

import { getLogger } from '../../Logger/Index.js';
import { isFail } from '../../Types/Index.js';
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
 * Lazily imports ConfigLoader and ConfigValidator and runs all validation checks.
 *
 * The lazy import is preserved from the original implementation to minimise
 * the blast radius of this refactor; there is no circular dependency today.
 *
 * @returns Formatted validation report string for display in Telegram.
 */
export async function runConfigValidation(): Promise<string> {
  const configLoaderModule = await import('../../Config/ConfigLoader.js');
  const configValidatorModule = await import('../../Config/ConfigValidator.js');
  const loader = new configLoaderModule.ConfigLoader();
  const rawResult = loader.loadRaw();
  if (isFail(rawResult)) {
    return `[FAIL] Cannot load config: ${rawResult.message}`;
  }
  const validator = new configValidatorModule.ConfigValidator();
  const results = await validator.validateAll(rawResult.data);
  return configValidatorModule.ConfigValidator.formatReport(results);
}
