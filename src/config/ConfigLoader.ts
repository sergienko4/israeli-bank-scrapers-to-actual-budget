/**
 * Configuration loader
 * Follows Single Responsibility Principle: Only handles configuration loading
 */

import { readFileSync, existsSync } from 'fs';
import { ImporterConfig, BankConfig, BankTarget, NotificationConfig } from '../types/index.js';
import { ConfigurationError } from '../errors/ErrorTypes.js';

export interface IConfigLoader {
  load(): ImporterConfig;
}

// OCP: add new banks by adding entries — no if/else changes needed
const credentialSpecs: Record<string, { displayName: string; required: (keyof BankConfig)[]; label: string }> = {
  discount:  { displayName: 'Discount bank', required: ['id', 'password', 'num'],             label: 'id, password, num' },
  leumi:     { displayName: 'leumi',         required: ['username', 'password'],               label: 'username, password' },
  union:     { displayName: 'union',         required: ['username', 'password'],               label: 'username, password' },
  hapoalim:  { displayName: 'Hapoalim',     required: ['userCode', 'password'],               label: 'userCode, password' },
  yahav:     { displayName: 'Yahav',         required: ['nationalID', 'password'],             label: 'nationalID, password' },
  onezero:   { displayName: 'OneZero',       required: ['email', 'password', 'phoneNumber'],  label: 'email, password, phoneNumber' },
};

export class ConfigLoader implements IConfigLoader {
  private readonly configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath || '/app/config.json';
  }

  load(): ImporterConfig {
    const config = this.loadFromFile() ?? this.loadFromEnvironment();
    this.validate(config);
    return config;
  }

  private loadFromFile(): ImporterConfig | null {
    if (!existsSync(this.configPath)) {
      console.log('📄 config.json not found, using environment variables');
      return null;
    }
    try {
      console.log('📄 Loading configuration from config.json');
      return JSON.parse(readFileSync(this.configPath, 'utf8')) as ImporterConfig;
    } catch (error) {
      if (error instanceof ConfigurationError) throw error;
      console.warn('⚠️  Failed to parse config.json, falling back to environment variables');
      return null;
    }
  }

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

  private buildTargetFromEnv(prefix: string): BankTarget[] {
    const accounts = process.env[`${prefix}_ACCOUNTS`] || 'all';
    return [{
      actualAccountId: process.env[`${prefix}_ACCOUNT_ID`] || '',
      reconcile: process.env[`${prefix}_RECONCILE`] === 'true',
      accounts: accounts === 'all' ? 'all' : accounts.split(',')
    }];
  }

  private addDiscountFromEnv(banks: Record<string, BankConfig>): void {
    if (!process.env.DISCOUNT_ID) return;
    banks.discount = {
      id: process.env.DISCOUNT_ID, password: process.env.DISCOUNT_PASSWORD,
      num: process.env.DISCOUNT_NUM, startDate: process.env.DISCOUNT_START_DATE,
      targets: this.buildTargetFromEnv('DISCOUNT')
    };
  }

  private addLeumiFromEnv(banks: Record<string, BankConfig>): void {
    if (!process.env.LEUMI_USERNAME) return;
    banks.leumi = {
      username: process.env.LEUMI_USERNAME, password: process.env.LEUMI_PASSWORD,
      startDate: process.env.LEUMI_START_DATE, targets: this.buildTargetFromEnv('LEUMI')
    };
  }

  private addHapoalimFromEnv(banks: Record<string, BankConfig>): void {
    if (!process.env.HAPOALIM_USER_CODE) return;
    banks.hapoalim = {
      userCode: process.env.HAPOALIM_USER_CODE, password: process.env.HAPOALIM_PASSWORD,
      startDate: process.env.HAPOALIM_START_DATE, targets: this.buildTargetFromEnv('HAPOALIM')
    };
  }

  // ─── Validation ───

  private validate(config: ImporterConfig): void {
    this.validateActualConfig(config);
    this.validateServerUrl(config.actual.init.serverURL);
    if (Object.keys(config.banks).length === 0) {
      throw new ConfigurationError('No bank credentials configured. Please set environment variables or use config.json');
    }
    for (const [bankName, bankConfig] of Object.entries(config.banks)) {
      this.validateBank(bankName, bankConfig);
    }
    if (config.notifications?.enabled) this.validateNotifications(config.notifications);
  }

  private validateActualConfig(config: ImporterConfig): void {
    if (!config.actual.init.password) {
      throw new ConfigurationError('ACTUAL_PASSWORD is required (set via environment variable or config.json)');
    }
    if (!config.actual.budget.syncId) {
      throw new ConfigurationError('ACTUAL_BUDGET_SYNC_ID is required (set via environment variable or config.json)');
    }
    if (!this.isValidUUID(config.actual.budget.syncId)) {
      throw new ConfigurationError(`Invalid ACTUAL_BUDGET_SYNC_ID format. Expected UUID, got: ${config.actual.budget.syncId}`);
    }
  }

  private validateServerUrl(url: string): void {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new ConfigurationError(`Invalid serverURL format. Must start with http:// or https://, got: ${url}`);
    }
  }

  private validateNotifications(config: NotificationConfig): void {
    if (!config.telegram) return;
    if (!config.telegram.botToken) throw new ConfigurationError('Telegram botToken is required when telegram notifications are configured');
    if (!/^\d+:.+$/.test(config.telegram.botToken)) throw new ConfigurationError('Invalid Telegram botToken format. Expected format: "123456789:ABCdef..."');
    if (!config.telegram.chatId) throw new ConfigurationError('Telegram chatId is required when telegram notifications are configured');
    this.validateEnumField(config.telegram.messageFormat, ['summary', 'compact', 'ledger', 'emoji'], 'messageFormat');
    this.validateEnumField(config.telegram.showTransactions, ['new', 'all', 'none'], 'showTransactions');
  }

  private validateEnumField(value: string | undefined, allowed: string[], fieldName: string): void {
    if (value && !allowed.includes(value)) {
      throw new ConfigurationError(`Invalid ${fieldName} "${value}". Must be one of: ${allowed.join(', ')}`);
    }
  }

  private isValidUUID(uuid: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
  }

  // ─── Bank validation ───

  private validateBank(bankName: string, config: BankConfig): void {
    this.validateDateConfig(bankName, config);
    this.validateTargets(bankName, config.targets);
    this.validateBankCredentials(bankName, config);
  }

  private validateDateConfig(bankName: string, config: BankConfig): void {
    if (config.startDate && config.daysBack) {
      throw new ConfigurationError(`${bankName}: cannot use both "startDate" and "daysBack". Choose one.`);
    }
    if (config.daysBack !== undefined) this.validateDaysBack(bankName, config.daysBack);
    if (config.startDate) this.validateStartDate(bankName, config.startDate);
  }

  private validateDaysBack(bankName: string, daysBack: number): void {
    if (!Number.isInteger(daysBack) || daysBack < 1 || daysBack > 30) {
      throw new ConfigurationError(`${bankName}: "daysBack" must be an integer between 1 and 30. Got: ${daysBack}`);
    }
  }

  private validateStartDate(bankName: string, startDate: string): void {
    const date = new Date(startDate);
    if (isNaN(date.getTime())) {
      throw new ConfigurationError(`Invalid startDate format for ${bankName}: "${startDate}". Expected YYYY-MM-DD format (e.g., "2026-02-15")`);
    }
    if (date > new Date()) {
      throw new ConfigurationError(`startDate cannot be in the future for ${bankName}. Got: ${startDate}`);
    }
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    if (date < oneYearAgo) {
      throw new ConfigurationError(`${bankName}: startDate cannot be more than 1 year ago. Got: ${startDate}`);
    }
  }

  private validateTargets(bankName: string, targets: BankConfig['targets']): void {
    if (!targets || targets.length === 0) {
      throw new ConfigurationError(`No targets configured for ${bankName}. At least one target is required.`);
    }
    targets.forEach((target, idx) => this.validateTarget(bankName, target, idx));
  }

  private validateTarget(bankName: string, target: { actualAccountId: string; accounts: string[] | 'all'; reconcile: boolean }, idx: number): void {
    if (!target.actualAccountId) throw new ConfigurationError(`Missing actualAccountId for ${bankName} target ${idx}`);
    if (!this.isValidUUID(target.actualAccountId)) {
      throw new ConfigurationError(
        `Invalid actualAccountId format for ${bankName} target ${idx}.\n` +
        `  Expected: UUID format (e.g., "12345678-1234-1234-1234-123456789abc")\n` +
        `  Got: "${target.actualAccountId}"`
      );
    }
    if (!target.accounts) throw new ConfigurationError(`Missing accounts field for ${bankName} target ${idx}. Use "all" or an array of account numbers.`);
    if (target.accounts !== 'all' && (!Array.isArray(target.accounts) || target.accounts.length === 0)) {
      throw new ConfigurationError(`Invalid accounts field for ${bankName} target ${idx}. Must be "all" or a non-empty array.`);
    }
    if (typeof target.reconcile !== 'boolean') throw new ConfigurationError(`Invalid reconcile field for ${bankName} target ${idx}. Must be true or false.`);
  }

  // ─── Credential validation (OCP map) ───

  private validateBankCredentials(bankName: string, config: BankConfig): void {
    this.validateFieldFormats(bankName, config);
    this.validateRequiredCredentials(bankName, config);
  }

  private validateFieldFormats(bankName: string, config: BankConfig): void {
    if (config.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.email)) {
      throw new ConfigurationError(`Invalid email format for ${bankName}: "${config.email}"`);
    }
    if (config.phoneNumber && !/^\+?\d{10,15}$/.test(config.phoneNumber.replace(/[\s-]/g, ''))) {
      throw new ConfigurationError(`Invalid phone number format for ${bankName}: "${config.phoneNumber}". Expected 10-15 digits.`);
    }
    if (config.card6Digits && !/^\d{6}$/.test(config.card6Digits)) {
      throw new ConfigurationError(`Invalid card6Digits format for ${bankName}: "${config.card6Digits}". Expected 6 digits.`);
    }
  }

  private validateRequiredCredentials(bankName: string, config: BankConfig): void {
    const spec = credentialSpecs[bankName.toLowerCase()];
    if (!spec) return;
    const missing = spec.required.filter(field => !config[field]);
    if (missing.length > 0) {
      throw new ConfigurationError(`${spec.displayName} requires: ${spec.label}`);
    }
  }
}
