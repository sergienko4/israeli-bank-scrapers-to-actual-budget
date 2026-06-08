/**
 * Validators for the optional top-level config blocks (notifications, spendingWatch, proxy).
 *
 * Iterated by `ConfigLoader.validateOptionalSections` instead of the legacy
 * `if (config.X) validateX()` chain. Adding a new optional section is one
 * registry entry — no edits to `ConfigLoader`.
 */
import type { IImporterConfig, Procedure } from '../../Types/Index.js';
import { succeed } from '../../Types/Index.js';
import {
  validateNotifications,
  validateProxy,
  validateSpendingWatch,
} from '../ConfigLoaderValidator.js';
import type { IBlockValidator } from './IBlockValidator.js';

const NOTIFICATIONS_BLOCK_VALIDATOR: IBlockValidator<IImporterConfig> = {
  name: 'notifications',
  /**
   * Decides whether the notifications block should be validated.
   * @param config - The parent IImporterConfig.
   * @returns True if `config.notifications.enabled` is truthy.
   */
  applies(config: IImporterConfig): boolean {
    return Boolean(config.notifications?.enabled);
  },
  /**
   * Validates the notifications block when present.
   * @param config - The parent IImporterConfig.
   * @returns Procedure success when block is absent or valid, else failure.
   */
  validate(config: IImporterConfig): Procedure<{ valid: true }> {
    const block = config.notifications;
    if (!block) return succeed({ valid: true as const });
    return validateNotifications(block);
  },
};

const SPENDING_WATCH_BLOCK_VALIDATOR: IBlockValidator<IImporterConfig> = {
  name: 'spendingWatch',
  /**
   * Decides whether the spendingWatch block should be validated.
   * @param config - The parent IImporterConfig.
   * @returns True if `config.spendingWatch` is truthy.
   */
  applies(config: IImporterConfig): boolean {
    return Boolean(config.spendingWatch);
  },
  /**
   * Validates the spendingWatch block when present.
   * @param config - The parent IImporterConfig.
   * @returns Procedure success when block is absent or valid, else failure.
   */
  validate(config: IImporterConfig): Procedure<{ valid: true }> {
    const block = config.spendingWatch;
    if (!block) return succeed({ valid: true as const });
    return validateSpendingWatch(block);
  },
};

const PROXY_BLOCK_VALIDATOR: IBlockValidator<IImporterConfig> = {
  name: 'proxy',
  /**
   * Decides whether the proxy block should be validated.
   * @param config - The parent IImporterConfig.
   * @returns True if `config.proxy` is truthy.
   */
  applies(config: IImporterConfig): boolean {
    return Boolean(config.proxy);
  },
  /**
   * Validates the proxy block when present.
   * @param config - The parent IImporterConfig.
   * @returns Procedure success when block is absent or valid, else failure.
   */
  validate(config: IImporterConfig): Procedure<{ valid: true }> {
    const block = config.proxy;
    if (!block) return succeed({ valid: true as const });
    return validateProxy(block);
  },
};

/**
 * Registry of optional-section block validators iterated by ConfigLoader.
 *
 * Order matters only for which error surfaces first on multi-section failures;
 * legacy order preserved (notifications → spendingWatch → proxy).
 */
const OPTIONAL_SECTION_VALIDATORS: readonly IBlockValidator<IImporterConfig>[] = [
  NOTIFICATIONS_BLOCK_VALIDATOR,
  SPENDING_WATCH_BLOCK_VALIDATOR,
  PROXY_BLOCK_VALIDATOR,
];

export default OPTIONAL_SECTION_VALIDATORS;
