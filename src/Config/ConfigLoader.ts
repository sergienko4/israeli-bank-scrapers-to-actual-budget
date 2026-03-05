/* eslint-disable max-lines */
/**
 * Configuration loader
 * Follows Single Responsibility Principle: Only handles configuration loading
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  ImporterConfig, BankConfig, BankTarget,
  NotificationConfig, SpendingWatchRule, ProxyConfig
} from '../Types/Index.js';
import { ConfigurationError } from '../Errors/ErrorTypes.js';
import { getLogger } from '../Logger/Index.js';
import {
  isEncryptedConfig, decryptConfig, getEncryptionPassword
} from './ConfigEncryption.js';

export interface IConfigLoader {
  load(): ImporterConfig;
}

// OCP: add new banks by adding entries — no if/else changes needed
type CredentialSpec = { displayName: string; required: (keyof BankConfig)[]; label: string };
const credentialSpecs: Record<string, CredentialSpec> = {
  discount:  { displayName: 'Discount bank', required: ['id', 'password', 'num'],
    label: 'id, password, num' },
  leumi:     { displayName: 'leumi',         required: ['username', 'password'],
    label: 'username, password' },
  hapoalim:  { displayName: 'Hapoalim',      required: ['userCode', 'password'],
    label: 'userCode, password' },
  yahav:     { displayName: 'Yahav',         required: ['nationalID', 'password'],
    label: 'nationalID, password' },
  onezero:   { displayName: 'OneZero',       required: ['email', 'password', 'phoneNumber'],
    label: 'email, password, phoneNumber' },
};

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
    if (process.env.PROXY_SERVER) config.proxy = { server: process.env.PROXY_SERVER };
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
    this.validateActualConfig(config);
    this.validateServerUrl(config.actual.init.serverURL);
    if (Object.keys(config.banks).length === 0) {
      throw new ConfigurationError(
        'No bank credentials configured. Please set environment variables or use config.json'
      );
    }
    for (const [bankName, bankConfig] of Object.entries(config.banks)) {
      this.validateBank(bankName, bankConfig);
    }
    if (config.notifications?.enabled) this.validateNotifications(config.notifications);
    if (config.spendingWatch) this.validateSpendingWatch(config.spendingWatch);
    if (config.proxy) this.validateProxy(config.proxy);
  }

  /**
   * Validates the Actual Budget section of the config (password, syncId, server URL).
   * @param config - The config whose actual block is validated.
   */
  private validateActualConfig(config: ImporterConfig): void {
    if (!config.actual.init.password) {
      throw new ConfigurationError(
        'ACTUAL_PASSWORD is required (set via environment variable or config.json)'
      );
    }
    if (!config.actual.budget.syncId) {
      throw new ConfigurationError(
        'ACTUAL_BUDGET_SYNC_ID is required (set via environment variable or config.json)'
      );
    }
    if (!this.isValidUUID(config.actual.budget.syncId)) {
      throw new ConfigurationError(
        `Invalid ACTUAL_BUDGET_SYNC_ID format. Expected UUID, got: ${config.actual.budget.syncId}`
      );
    }
  }

  /**
   * Validates that the Actual server URL starts with http:// or https://.
   * @param url - The server URL string to check.
   */
  private validateServerUrl(url: string): void {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new ConfigurationError(
        `Invalid serverURL format. Must start with http:// or https://, got: ${url}`
      );
    }
  }

  /**
   * Validates notification settings (Telegram and webhook) when notifications are enabled.
   * @param config - The NotificationConfig block to validate.
   */
  private validateNotifications(config: NotificationConfig): void {
    if (config.telegram) this.validateTelegramConfig(config.telegram);
    if (config.webhook) this.validateWebhookConfig(config.webhook);
  }

  /**
   * Validates Telegram bot token, chat ID, and enum fields.
   * @param telegram - The Telegram notification config to validate.
   */
  private validateTelegramConfig(telegram: NonNullable<NotificationConfig['telegram']>): void {
    if (!telegram.botToken) {
      throw new ConfigurationError(
        'Telegram botToken is required when telegram notifications are configured'
      );
    }
    if (!/^\d+:.+$/.test(telegram.botToken)) {
      throw new ConfigurationError(
        'Invalid Telegram botToken format. Expected format: "123456789:ABCdef..."'
      );
    }
    if (!telegram.chatId) {
      throw new ConfigurationError(
        'Telegram chatId is required when telegram notifications are configured'
      );
    }
    this.validateEnumField(telegram.messageFormat, ['summary', 'compact', 'ledger', 'emoji'],
      'messageFormat');
    this.validateEnumField(telegram.showTransactions, ['new', 'all', 'none'], 'showTransactions');
  }

  /**
   * Validates the spending watch rules array.
   * @param rules - Array of SpendingWatchRule objects to validate.
   */
  private validateSpendingWatch(rules: SpendingWatchRule[]): void {
    if (!Array.isArray(rules)) {
      throw new ConfigurationError('spendingWatch must be an array of rules');
    }
    rules.forEach((rule, idx) => this.validateWatchRule(rule, idx));
  }

  /**
   * Validates a single spending watch rule entry.
   * @param rule - The SpendingWatchRule to check.
   * @param idx - Zero-based index of the rule, used in error messages.
   */
  private validateWatchRule(rule: SpendingWatchRule, idx: number): void {
    if (!rule.alertFromAmount || rule.alertFromAmount <= 0) {
      throw new ConfigurationError(
        `spendingWatch[${idx}]: alertFromAmount is required and must be positive`
      );
    }
    const { numOfDayToCount } = rule;
    if (!numOfDayToCount || !Number.isInteger(numOfDayToCount)
      || numOfDayToCount < 1 || numOfDayToCount > 365) {
      throw new ConfigurationError(
        `spendingWatch[${idx}]: numOfDayToCount must be an integer between 1 and 365`
      );
    }
    if (rule.watchPayees !== undefined && !Array.isArray(rule.watchPayees)) {
      throw new ConfigurationError(
        `spendingWatch[${idx}]: watchPayees must be an array of strings`
      );
    }
  }

  /**
   * Validates the webhook URL and format enum.
   * @param webhook - The webhook notification config to validate.
   */
  private validateWebhookConfig(webhook: NonNullable<NotificationConfig['webhook']>): void {
    if (!webhook.url) {
      throw new ConfigurationError(
        'Webhook url is required when webhook notifications are configured'
      );
    }
    if (!webhook.url.startsWith('http://') && !webhook.url.startsWith('https://')) {
      throw new ConfigurationError(
        `Invalid webhook url format. Must start with http:// or https://, got: ${webhook.url}`
      );
    }
    this.validateEnumField(webhook.format, ['slack', 'discord', 'plain'], 'webhook format');
  }

  /**
   * Validates the proxy configuration server URL format.
   * @param proxy - The ProxyConfig to validate.
   */
  private validateProxy(proxy: ProxyConfig): void {
    if (!proxy.server) {
      throw new ConfigurationError('proxy.server is required when proxy is configured');
    }
    const validPrefixes = ['socks5://', 'socks4://', 'http://', 'https://'];
    if (!validPrefixes.some(p => proxy.server.startsWith(p))) {
      throw new ConfigurationError(
        `Invalid proxy.server format "${proxy.server}". ` +
        `Must start with socks5://, socks4://, http://, or https://`
      );
    }
  }

  /**
   * Validates that a field value is one of the allowed enum strings.
   * @param value - The field value to check (may be undefined).
   * @param allowed - Array of permitted string values.
   * @param fieldName - Display name of the field used in error messages.
   */
  private validateEnumField(value: string | undefined, allowed: string[], fieldName: string): void {
    if (value && !allowed.includes(value)) {
      throw new ConfigurationError(
        `Invalid ${fieldName} "${value}". Must be one of: ${allowed.join(', ')}`
      );
    }
  }

  /**
   * Checks whether a string matches the standard UUID v4 format.
   * @param uuid - The string to test.
   * @returns True if the string is a valid UUID.
   */
  private isValidUUID(uuid: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
  }

  // ─── Bank validation ───

  /**
   * Validates all settings for a single bank entry.
   * @param bankName - The key used for this bank in the banks map.
   * @param config - The BankConfig object to validate.
   */
  private validateBank(bankName: string, config: BankConfig): void {
    this.validateDateConfig(bankName, config);
    this.validateTargets(bankName, config.targets);
    this.validateBankCredentials(bankName, config);
  }

  /**
   * Validates that only one of startDate or daysBack is set, and their values are in range.
   * @param bankName - Bank name used in error messages.
   * @param config - The bank config containing the date settings.
   */
  private validateDateConfig(bankName: string, config: BankConfig): void {
    if (config.startDate && config.daysBack) {
      throw new ConfigurationError(
        `${bankName}: cannot use both "startDate" and "daysBack". Choose one.`
      );
    }
    if (config.daysBack !== undefined) this.validateDaysBack(bankName, config.daysBack);
    if (config.startDate) this.validateStartDate(bankName, config.startDate);
  }

  /**
   * Validates that daysBack is an integer between 1 and 30.
   * @param bankName - Bank name used in error messages.
   * @param daysBack - The daysBack value to validate.
   */
  private validateDaysBack(bankName: string, daysBack: number): void {
    if (!Number.isInteger(daysBack) || daysBack < 1 || daysBack > 30) {
      throw new ConfigurationError(
        `${bankName}: "daysBack" must be an integer between 1 and 30. Got: ${daysBack}`
      );
    }
  }

  /**
   * Returns a Date representing exactly one year before today.
   * @returns Date object set to one year ago.
   */
  private getOneYearAgo(): Date {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d;
  }

  /**
   * Validates startDate format, ensures it is not in the future, and not older than one year.
   * @param bankName - Bank name used in error messages.
   * @param startDate - The startDate string (YYYY-MM-DD) to validate.
   */
  private validateStartDate(bankName: string, startDate: string): void {
    const date = new Date(startDate);
    if (isNaN(date.getTime())) {
      throw new ConfigurationError(
        `Invalid startDate format for ${bankName}: "${startDate}". ` +
        `Expected YYYY-MM-DD format (e.g., "2026-02-15")`
      );
    }
    if (date > new Date()) {
      throw new ConfigurationError(
        `startDate cannot be in the future for ${bankName}. Got: ${startDate}`
      );
    }
    if (date < this.getOneYearAgo()) {
      throw new ConfigurationError(
        `${bankName}: startDate cannot be more than 1 year ago. Got: ${startDate}`
      );
    }
  }

  /**
   * Validates that at least one target is configured and each target is valid.
   * @param bankName - Bank name used in error messages.
   * @param targets - The array of BankTarget objects to validate.
   */
  private validateTargets(bankName: string, targets: BankConfig['targets']): void {
    if (!targets || targets.length === 0) {
      throw new ConfigurationError(
        `No targets configured for ${bankName}. At least one target is required.`
      );
    }
    targets.forEach((target, idx) => this.validateTarget(bankName, target, idx));
  }

  /**
   * Validates that a target's actualAccountId is present and is a valid UUID.
   * @param bankName - Bank name used in error messages.
   * @param accountId - The actualAccountId string to validate.
   * @param idx - Zero-based target index used in error messages.
   */
  private validateTargetId(bankName: string, accountId: string, idx: number): void {
    if (!accountId) {
      throw new ConfigurationError(`Missing actualAccountId for ${bankName} target ${idx}`);
    }
    if (!this.isValidUUID(accountId)) {
      throw new ConfigurationError(
        `Invalid actualAccountId format for ${bankName} target ${idx}.\n` +
        `  Expected: UUID format (e.g., "12345678-1234-1234-1234-123456789abc")\n` +
        `  Got: "${accountId}"`
      );
    }
  }

  /**
   * Validates that the accounts field is either "all" or a non-empty string array.
   * @param bankName - Bank name used in error messages.
   * @param accounts - The accounts value from the BankTarget.
   * @param idx - Zero-based target index used in error messages.
   */
  private validateTargetAccounts(
    bankName: string, accounts: string[] | 'all', idx: number
  ): void {
    if (!accounts) {
      throw new ConfigurationError(
        `Missing accounts field for ${bankName} target ${idx}. ` +
        `Use "all" or an array of account numbers.`
      );
    }
    if (accounts !== 'all' && (!Array.isArray(accounts) || accounts.length === 0)) {
      throw new ConfigurationError(
        `Invalid accounts field for ${bankName} target ${idx}. ` +
        `Must be "all" or a non-empty array.`
      );
    }
  }

  /**
   * Validates a single BankTarget: ID, accounts field, and reconcile type.
   * @param bankName - Bank name used in error messages.
   * @param target - The target object to validate.
   * @param target.actualAccountId - UUID of the Actual account.
   * @param target.accounts - Account filter: 'all' or array of account numbers.
   * @param target.reconcile - Whether reconciliation is enabled for this target.
   * @param idx - Zero-based target index used in error messages.
   */
  private validateTarget(
    bankName: string,
    target: { actualAccountId: string; accounts: string[] | 'all'; reconcile: boolean },
    idx: number
  ): void {
    this.validateTargetId(bankName, target.actualAccountId, idx);
    this.validateTargetAccounts(bankName, target.accounts, idx);
    if (typeof target.reconcile !== 'boolean') {
      throw new ConfigurationError(
        `Invalid reconcile field for ${bankName} target ${idx}. Must be true or false.`
      );
    }
  }

  // ─── Credential validation (OCP map) ───

  /**
   * Validates credential field formats and required credential presence for a bank.
   * @param bankName - The bank key used to look up the credential spec.
   * @param config - The BankConfig whose credentials to validate.
   */
  private validateBankCredentials(bankName: string, config: BankConfig): void {
    this.validateFieldFormats(bankName, config);
    this.validateRequiredCredentials(bankName, config);
  }

  /**
   * Validates email, phone number, and card6Digits format for a bank config.
   * @param bankName - Bank name used in error messages.
   * @param config - The BankConfig whose field formats to validate.
   */
  private validateFieldFormats(bankName: string, config: BankConfig): void {
    if (config.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.email)) {
      throw new ConfigurationError(`Invalid email format for ${bankName}: "${config.email}"`);
    }
    const phone = config.phoneNumber?.replace(/[\s-]/g, '');
    if (config.phoneNumber && phone && !/^\+?\d{10,15}$/.test(phone)) {
      throw new ConfigurationError(
        `Invalid phone number format for ${bankName}: "${config.phoneNumber}". ` +
        `Expected 10-15 digits.`
      );
    }
    if (config.card6Digits && !/^\d{6}$/.test(config.card6Digits)) {
      throw new ConfigurationError(
        `Invalid card6Digits format for ${bankName}: "${config.card6Digits}". Expected 6 digits.`
      );
    }
  }

  /**
   * Checks that all required credential fields are present for known banks.
   * @param bankName - The bank key to look up in the credential spec map.
   * @param config - The BankConfig to check for required fields.
   */
  private validateRequiredCredentials(bankName: string, config: BankConfig): void {
    const spec = credentialSpecs[bankName.toLowerCase()];
    if (!spec) return;
    const missing = spec.required.filter(field => !config[field]);
    if (missing.length > 0) {
      throw new ConfigurationError(`${spec.displayName} requires: ${spec.label}`);
    }
  }
}
