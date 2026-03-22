/**
 * Configuration loader
 * Follows Single Responsibility Principle: Only handles configuration loading
 */

import { existsSync,readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { ConfigurationError } from '../Errors/ErrorTypes.js';
import { getLogger } from '../Logger/Index.js';
import type {
IBankConfig, IBankTarget,
  IImporterConfig, Procedure} from '../Types/Index.js';
import { fail, isFail, succeed } from '../Types/Index.js';
import {
decryptConfig, getEncryptionPassword,
  isEncryptedConfig} from './ConfigEncryption.js';
import {
  validateActualConfig, validateBank,
validateNotifications,
validateProxy, validateServerUrl,   validateSpendingWatch} from './ConfigLoaderValidator.js';

/** Type for values in nested config merge objects. */
type ConfigValue = object | string | number | boolean | null;

/** Type alias for nested config merge objects. */
type ConfigRecord = Record<string, ConfigValue>;

export interface IConfigLoader {
  load(): Procedure<IImporterConfig>;
}


/** Loads IImporterConfig from config.json, credentials.json, or environment variables. */
export class ConfigLoader implements IConfigLoader {
  private readonly _configPath: string;

  /**
   * Creates a ConfigLoader pointing at the given config file path.
   * @param configPath - Absolute path to config.json; defaults to /app/config.json.
   */
  constructor(configPath?: string) {
    this._configPath = configPath || '/app/config.json';
  }

  /**
   * Loads, merges, and validates the full importer configuration.
   * @returns Procedure containing the validated IImporterConfig or a failure message.
   */
  public load(): Procedure<IImporterConfig> {
    const fileResult = this.loadFromFile();
    if (isFail(fileResult) && fileResult.status !== 'not-found') return fileResult;
    const config = isFail(fileResult) ? ConfigLoader.loadFromEnvironment() : fileResult.data;
    ConfigLoader.applyEnvOverrides(config);
    return ConfigLoader.validate(config);
  }

  /**
   * Loads and merges config without running validation — used by --validate mode.
   * @returns Procedure containing the merged IImporterConfig or a failure message.
   */
  public loadRaw(): Procedure<IImporterConfig> {
    const fileResult = this.loadFromFile();
    if (isFail(fileResult) && fileResult.status !== 'not-found') return fileResult;
    const config = isFail(fileResult) ? ConfigLoader.loadFromEnvironment() : fileResult.data;
    ConfigLoader.applyEnvOverrides(config);
    return succeed(config);
  }

  /**
   * Applies environment-variable overrides onto an already-loaded config.
   * @param config - The config object to mutate with env-var values.
   */
  private static applyEnvOverrides(config: IImporterConfig): void {
    if (process.env.PROXY_SERVER) config.proxy = { server: process.env.PROXY_SERVER };
  }

  /**
   * Attempts to load configuration from config.json (and optional credentials.json).
   * @returns Procedure containing the parsed IImporterConfig, or failure if absent/unreadable.
   */
  private loadFromFile(): Procedure<IImporterConfig> {
    if (!existsSync(this._configPath)) {
      getLogger().info('📄 config.json not found, using environment variables');
      return fail('config.json not found', { status: 'not-found' });
    }
    try {
      getLogger().info('📄 Loading configuration from config.json');
      const config = ConfigLoader.readJsonFile(this._configPath);
      const credResult = this.loadCredentials();
      const merged = credResult.success
        ? this.deepMerge(config, credResult.data) : config;
      return succeed(merged);
    } catch (error: unknown) {
      if (error instanceof ConfigurationError) {
        return fail(error.message, { error, status: 'config-error' });
      }
      getLogger().warn('⚠️  Failed to parse config, falling back to environment variables');
      return fail('Failed to parse config file', { status: 'parse-error' });
    }
  }

  /**
   * Loads a separate credentials.json from the same directory as config.json.
   * @returns Procedure containing the parsed credentials config, or failure if not found.
   */
  private loadCredentials(): Procedure<IImporterConfig> {
    const configDir = dirname(this._configPath);
    const credPath = join(configDir, 'credentials.json');
    if (!existsSync(credPath)) {
      return fail('credentials.json not found');
    }
    getLogger().info('🔑 Loading credentials from credentials.json');
    const credentials = ConfigLoader.readJsonFile(credPath);
    return succeed(credentials);
  }

  /**
   * Reads and parses a JSON file, decrypting it first if it is an IEncryptedConfig.
   * @param filePath - Absolute path to the JSON file to read.
   * @returns The parsed IImporterConfig object.
   */
  private static readJsonFile(filePath: string): IImporterConfig {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, string | number | boolean>;
    if (!isEncryptedConfig(parsed)) return parsed as unknown as IImporterConfig;
    return ConfigLoader.decryptFile(raw, filePath);
  }

  /**
   * Decrypts an encrypted config file using the environment password.
   * @param raw - Raw JSON string of the encrypted payload.
   * @param filePath - File path used in error messages.
   * @returns The decrypted IImporterConfig object.
   */
  private static decryptFile(raw: string, filePath: string): IImporterConfig {
    const password = getEncryptionPassword();
    if (!password) {
      throw new ConfigurationError(
        `🔐 ${filePath} is encrypted. Set CREDENTIALS_ENCRYPTION_PASSWORD env var.`
      );
    }
    getLogger().info(`🔐 Decrypting ${filePath}...`);
    const decrypted = decryptConfig(raw, password);
    return JSON.parse(decrypted) as IImporterConfig;
  }

  /**
   * Deep-merges source into target, returning a new merged IImporterConfig.
   * @param target - Base config to merge into.
   * @param source - Partial config whose values override or extend the target.
   * @returns A new IImporterConfig with source values merged on top of target.
   */
  private deepMerge(target: IImporterConfig, source: Partial<IImporterConfig>): IImporterConfig {
    const result: ConfigRecord = { ...target };
    for (const [key, srcVal] of Object.entries(source)) {
      const tgtVal = result[key];
      result[key] = this.mergeValue(tgtVal, srcVal);
    }
    return result as unknown as IImporterConfig;
  }

  /**
   * Recursively merges a single source value into a target value.
   * @param target - The existing value from the base config.
   * @param source - The incoming value from the credentials/override config.
   * @returns The merged value (source wins for primitives; deep-merge for objects).
   */
  private mergeValue(target: ConfigValue, source: ConfigValue): ConfigValue {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return source;
    if (!target || typeof target !== 'object' || Array.isArray(target)) return source;
    const merged: ConfigRecord = { ...(target as ConfigRecord) };
    for (const [k, v] of Object.entries(source as ConfigRecord)) {
      merged[k] = this.mergeValue(merged[k], v);
    }
    return merged;
  }

  /**
   * Builds a minimal IImporterConfig from environment variables.
   * @returns An IImporterConfig populated with values from ACTUAL_* and bank env vars.
   */
  private static loadFromEnvironment(): IImporterConfig {
    const config: IImporterConfig = {
      actual: {
        init: {
          dataDir: process.env.ACTUAL_DATA_DIR || './data',
          password: process.env.ACTUAL_PASSWORD || '',
          serverURL: process.env.ACTUAL_SERVER_URL || 'http://actual_server:5006'
        },
        budget: {
          syncId: process.env.ACTUAL_BUDGET_SYNC_ID || '',
          password: process.env.ACTUAL_BUDGET_PASSWORD || null
        }
      },
      banks: {}
    };
    ConfigLoader.addDiscountFromEnv(config.banks);
    ConfigLoader.addLeumiFromEnv(config.banks);
    ConfigLoader.addHapoalimFromEnv(config.banks);
    return config;
  }

  /**
   * Builds a IBankTarget array from environment variables with the given prefix.
   * @param prefix - Env var prefix (e.g. "DISCOUNT") used to find account settings.
   * @returns Array containing one IBankTarget derived from the env vars.
   */
  private static buildTargetFromEnv(prefix: string): IBankTarget[] {
    const accounts = process.env[`${prefix}_ACCOUNTS`] || 'all';
    return [{
      actualAccountId: process.env[`${prefix}_ACCOUNT_ID`] || '',
      reconcile: process.env[`${prefix}_RECONCILE`] === 'true',
      accounts: accounts === 'all' ? 'all' : accounts.split(',')
    }];
  }

  /**
   * Adds Discount bank config to the banks map when DISCOUNT_ID env var is set.
   * @param banks - Mutable banks record to add the Discount entry to.
   */
  private static addDiscountFromEnv(banks: Record<string, IBankConfig>): void {
    if (!process.env.DISCOUNT_ID) return;
    banks.discount = {
      id: process.env.DISCOUNT_ID, password: process.env.DISCOUNT_PASSWORD,
      num: process.env.DISCOUNT_NUM, startDate: process.env.DISCOUNT_START_DATE,
      targets: ConfigLoader.buildTargetFromEnv('DISCOUNT')
    };
  }

  /**
   * Adds Leumi bank config to the banks map when LEUMI_USERNAME env var is set.
   * @param banks - Mutable banks record to add the Leumi entry to.
   */
  private static addLeumiFromEnv(banks: Record<string, IBankConfig>): void {
    if (!process.env.LEUMI_USERNAME) return;
    banks.leumi = {
      username: process.env.LEUMI_USERNAME, password: process.env.LEUMI_PASSWORD,
      startDate: process.env.LEUMI_START_DATE, targets: ConfigLoader.buildTargetFromEnv('LEUMI')
    };
  }

  /**
   * Adds Hapoalim bank config to the banks map when HAPOALIM_USER_CODE env var is set.
   * @param banks - Mutable banks record to add the Hapoalim entry to.
   */
  private static addHapoalimFromEnv(banks: Record<string, IBankConfig>): void {
    if (!process.env.HAPOALIM_USER_CODE) return;
    banks.hapoalim = {
      userCode: process.env.HAPOALIM_USER_CODE, password: process.env.HAPOALIM_PASSWORD,
      startDate: process.env.HAPOALIM_START_DATE, targets: ConfigLoader.buildTargetFromEnv('HAPOALIM')
    };
  }

  // ─── Validation ───

  /**
   * Validates the fully merged config, returning a Procedure with the config or failure.
   * @param config - The merged IImporterConfig to validate.
   * @returns Procedure containing the validated config on success, or failure message.
   */
  private static validate(config: IImporterConfig): Procedure<IImporterConfig> {
    const actualResult = validateActualConfig(config);
    if (isFail(actualResult)) return fail(actualResult.message, { status: 'config-error' });
    const urlResult = validateServerUrl(config.actual.init.serverURL);
    if (isFail(urlResult)) return fail(urlResult.message, { status: 'config-error' });
    if (Object.keys(config.banks).length === 0) {
      return fail(
        'No bank credentials configured. Please set environment variables or use config.json',
        { status: 'config-error' }
      );
    }
    const bankValidation = ConfigLoader.validateAllBanks(config);
    if (isFail(bankValidation)) return bankValidation;
    const optionalResult = ConfigLoader.validateOptionalSections(config);
    if (isFail(optionalResult)) return optionalResult;
    return succeed(config);
  }

  /**
   * Validates all bank entries in the config.
   * @param config - The IImporterConfig whose banks to validate.
   * @returns Procedure success or first bank validation failure.
   */
  private static validateAllBanks(config: IImporterConfig): Procedure<{ valid: true }> {
    for (const [bankName, bankConfig] of Object.entries(config.banks)) {
      const bankResult = validateBank(bankName, bankConfig);
      if (isFail(bankResult)) return fail(bankResult.message, { status: 'config-error' });
    }
    return succeed({ valid: true as const });
  }

  /**
   * Validates optional config sections (notifications, spending watch, proxy).
   * @param config - The IImporterConfig whose optional sections to validate.
   * @returns Procedure success or first validation failure.
   */
  private static validateOptionalSections(config: IImporterConfig): Procedure<{ valid: true }> {
    if (config.notifications?.enabled) {
      const notifResult = validateNotifications(config.notifications);
      if (isFail(notifResult)) return fail(notifResult.message, { status: 'config-error' });
    }
    if (config.spendingWatch) {
      const watchResult = validateSpendingWatch(config.spendingWatch);
      if (isFail(watchResult)) return fail(watchResult.message, { status: 'config-error' });
    }
    if (config.proxy) {
      const proxyResult = validateProxy(config.proxy);
      if (isFail(proxyResult)) return fail(proxyResult.message, { status: 'config-error' });
    }
    return succeed({ valid: true as const });
  }

}
