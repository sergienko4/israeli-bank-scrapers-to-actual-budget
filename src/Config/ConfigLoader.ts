/**
 * Configuration loader
 * Follows Single Responsibility Principle: Only handles configuration loading
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  ImporterConfig, BankConfig, BankTarget
} from '../Types/Index.js';
import { ConfigurationError } from '../Errors/ErrorTypes.js';
import { getLogger } from '../Logger/Index.js';
import {
  isEncryptedConfig, decryptConfig, getEncryptionPassword
} from './ConfigEncryption.js';
import {
  validateActualConfig, validateServerUrl, validateNotifications,
  validateSpendingWatch, validateProxy, validateBank
} from './ConfigLoaderValidator.js';

export interface IConfigLoader {
  load(): ImporterConfig;
}


/** Loads ImporterConfig from config.json, credentials.json, or environment variables. */
export class ConfigLoader implements IConfigLoader {
  private readonly configPath: string;

  /**
   * Creates a ConfigLoader pointing at the given config file path.
   * @param configPath - Absolute path to config.json; defaults to /app/config.json.
   */
  constructor(configPath?: string) {
    this.configPath = configPath || '/app/config.json';
  }

  /**
   * Loads, merges, and validates the full importer configuration.
   * @returns The validated ImporterConfig ready for use.
   */
  load(): ImporterConfig {
    const config = this.loadFromFile() ?? this.loadFromEnvironment();
    this.applyEnvOverrides(config);
    this.validate(config);
    return config;
  }

  /**
   * Loads and merges config without running validation — used by --validate mode.
   * @returns The merged ImporterConfig before validation checks.
   */
  loadRaw(): ImporterConfig {
    const config = this.loadFromFile() ?? this.loadFromEnvironment();
    this.applyEnvOverrides(config);
    return config;
  }

  /**
   * Applies environment-variable overrides onto an already-loaded config.
   * @param config - The config object to mutate with env-var values.
   */
  private applyEnvOverrides(config: ImporterConfig): void {
    if (process.env.PROXY_SERVER) {
      config.proxy = { server: process.env.PROXY_SERVER };
    }
    if (process.env.ACTUAL_BUDGET_SYNC_ID) {
      config.actual.budget.syncId = process.env.ACTUAL_BUDGET_SYNC_ID;
    }
    if (process.env.ACTUAL_SERVER_URL) {
      config.actual.init.serverURL = process.env.ACTUAL_SERVER_URL;
    }
    if (process.env.ACTUAL_PASSWORD) {
      config.actual.init.password = process.env.ACTUAL_PASSWORD;
    }
  }

  /**
   * Attempts to load configuration from config.json (and optional credentials.json).
   * @returns The parsed ImporterConfig, or null if the file is absent or unreadable.
   */
  private loadFromFile(): ImporterConfig | null {
    if (!existsSync(this.configPath)) {
      getLogger().info('📄 config.json not found, using environment variables');
      return null;
    }
    try {
      getLogger().info('📄 Loading configuration from config.json');
      const config = this.readJsonFile(this.configPath);
      const credentials = this.loadCredentials();
      return credentials ? this.deepMerge(config, credentials) : config;
    } catch (error: unknown) {
      if (error instanceof ConfigurationError) throw error;
      getLogger().warn('⚠️  Failed to parse config, falling back to environment variables');
      return null;
    }
  }

  /**
   * Loads a separate credentials.json from the same directory as config.json.
   * @returns The parsed credentials config, or null if the file does not exist.
   */
  private loadCredentials(): ImporterConfig | null {
    const credPath = join(dirname(this.configPath), 'credentials.json');
    if (!existsSync(credPath)) return null;
    getLogger().info('🔑 Loading credentials from credentials.json');
    return this.readJsonFile(credPath);
  }

  /**
   * Reads and parses a JSON file, decrypting it first if it is an EncryptedConfig.
   * @param filePath - Absolute path to the JSON file to read.
   * @returns The parsed ImporterConfig object.
   */
  private readJsonFile(filePath: string): ImporterConfig {
    const raw = readFileSync(filePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!isEncryptedConfig(parsed)) return parsed as ImporterConfig;
    return this.decryptFile(raw, filePath);
  }

  /**
   * Decrypts an encrypted config file using the environment password.
   * @param raw - Raw JSON string of the encrypted payload.
   * @param filePath - File path used in error messages.
   * @returns The decrypted ImporterConfig object.
   */
  private decryptFile(raw: string, filePath: string): ImporterConfig {
    const password = getEncryptionPassword();
    if (!password) {
      throw new ConfigurationError(
        `🔐 ${filePath} is encrypted. Set CREDENTIALS_ENCRYPTION_PASSWORD env var.`
      );
    }
    getLogger().info(`🔐 Decrypting ${filePath}...`);
    return JSON.parse(decryptConfig(raw, password)) as ImporterConfig;
  }

  /**
   * Deep-merges source into target, returning a new merged ImporterConfig.
   * @param target - Base config to merge into.
   * @param source - Partial config whose values override or extend the target.
   * @returns A new ImporterConfig with source values merged on top of target.
   */
  private deepMerge(target: ImporterConfig, source: Partial<ImporterConfig>): ImporterConfig {
    const result = { ...target } as Record<string, unknown>;
    for (const [key, srcVal] of Object.entries(source)) {
      const tgtVal = result[key];
      result[key] = this.mergeValue(tgtVal, srcVal);
    }
    return result as unknown as ImporterConfig;
  }

  /**
   * Recursively merges a single source value into a target value.
   * @param target - The existing value from the base config.
   * @param source - The incoming value from the credentials/override config.
   * @returns The merged value (source wins for primitives; deep-merge for objects).
   */
  private mergeValue(target: unknown, source: unknown): unknown {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return source;
    if (!target || typeof target !== 'object' || Array.isArray(target)) return source;
    const merged = { ...target as Record<string, unknown> };
    for (const [k, v] of Object.entries(source as Record<string, unknown>)) {
      merged[k] = this.mergeValue(merged[k], v);
    }
    return merged;
  }

  /**
   * Builds a minimal ImporterConfig from environment variables.
   * @returns An ImporterConfig populated with values from ACTUAL_* and bank env vars.
   */
  private loadFromEnvironment(): ImporterConfig {
    const config: ImporterConfig = {
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
    this.addDiscountFromEnv(config.banks);
    this.addLeumiFromEnv(config.banks);
    this.addHapoalimFromEnv(config.banks);
    return config;
  }

  /**
   * Builds a BankTarget array from environment variables with the given prefix.
   * @param prefix - Env var prefix (e.g. "DISCOUNT") used to find account settings.
   * @returns Array containing one BankTarget derived from the env vars.
   */
  private buildTargetFromEnv(prefix: string): BankTarget[] {
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
  private addDiscountFromEnv(banks: Record<string, BankConfig>): void {
    if (!process.env.DISCOUNT_ID) return;
    banks.discount = {
      id: process.env.DISCOUNT_ID, password: process.env.DISCOUNT_PASSWORD,
      num: process.env.DISCOUNT_NUM, startDate: process.env.DISCOUNT_START_DATE,
      targets: this.buildTargetFromEnv('DISCOUNT')
    };
  }

  /**
   * Adds Leumi bank config to the banks map when LEUMI_USERNAME env var is set.
   * @param banks - Mutable banks record to add the Leumi entry to.
   */
  private addLeumiFromEnv(banks: Record<string, BankConfig>): void {
    if (!process.env.LEUMI_USERNAME) return;
    banks.leumi = {
      username: process.env.LEUMI_USERNAME, password: process.env.LEUMI_PASSWORD,
      startDate: process.env.LEUMI_START_DATE, targets: this.buildTargetFromEnv('LEUMI')
    };
  }

  /**
   * Adds Hapoalim bank config to the banks map when HAPOALIM_USER_CODE env var is set.
   * @param banks - Mutable banks record to add the Hapoalim entry to.
   */
  private addHapoalimFromEnv(banks: Record<string, BankConfig>): void {
    if (!process.env.HAPOALIM_USER_CODE) return;
    banks.hapoalim = {
      userCode: process.env.HAPOALIM_USER_CODE, password: process.env.HAPOALIM_PASSWORD,
      startDate: process.env.HAPOALIM_START_DATE, targets: this.buildTargetFromEnv('HAPOALIM')
    };
  }

  // ─── Validation ───

  /**
   * Validates the fully merged config, throwing ConfigurationError on first failure.
   * @param config - The merged ImporterConfig to validate.
   */
  private validate(config: ImporterConfig): void {
    validateActualConfig(config);
    validateServerUrl(config.actual.init.serverURL);
    if (Object.keys(config.banks).length === 0) {
      throw new ConfigurationError(
        'No bank credentials configured. Please set environment variables or use config.json'
      );
    }
    for (const [bankName, bankConfig] of Object.entries(config.banks)) {
      validateBank(bankName, bankConfig);
    }
    if (config.notifications?.enabled) validateNotifications(config.notifications);
    if (config.spendingWatch) validateSpendingWatch(config.spendingWatch);
    if (config.proxy) validateProxy(config.proxy);
  }

}
