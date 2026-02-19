/**
 * Configuration loader
 * Follows Single Responsibility Principle: Only handles configuration loading
 */

import { readFileSync, existsSync } from 'fs';
import { ImporterConfig, BankConfig } from '../types/index.js';
import { ConfigurationError } from '../errors/ErrorTypes.js';

export interface IConfigLoader {
  load(): ImporterConfig;
}

export class ConfigLoader implements IConfigLoader {
  private readonly configPath: string;

  constructor(configPath?: string) {
    if (configPath) {
      this.configPath = configPath;
    } else {
      // Default to config.json in app root (/app in Docker)
      this.configPath = '/app/config.json';
    }
  }

  load(): ImporterConfig {
    // Try to load from config.json first
    if (existsSync(this.configPath)) {
      try {
        console.log('📄 Loading configuration from config.json');
        const configData = readFileSync(this.configPath, 'utf8');
        const config = JSON.parse(configData) as ImporterConfig;
        this.validate(config);
        return config;
      } catch (error) {
        if (error instanceof ConfigurationError) {
          throw error;
        }
        console.warn('⚠️  Failed to parse config.json, falling back to environment variables');
      }
    } else {
      console.log('📄 config.json not found, using environment variables');
    }

    // Build config from environment variables
    return this.loadFromEnvironment();
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

    // Add banks from environment variables
    this.addDiscountFromEnv(config.banks);
    this.addLeumiFromEnv(config.banks);
    this.addHapoalimFromEnv(config.banks);

    this.validate(config);
    return config;
  }

  private addDiscountFromEnv(banks: Record<string, BankConfig>): void {
    if (process.env.DISCOUNT_ID) {
      const accounts = process.env.DISCOUNT_ACCOUNTS || 'all';
      banks.discount = {
        id: process.env.DISCOUNT_ID,
        password: process.env.DISCOUNT_PASSWORD,
        num: process.env.DISCOUNT_NUM,
        startDate: process.env.DISCOUNT_START_DATE,
        targets: [{
          actualAccountId: process.env.DISCOUNT_ACCOUNT_ID || '',
          reconcile: process.env.DISCOUNT_RECONCILE === 'true',
          accounts: accounts === 'all' ? 'all' : accounts.split(',')
        }]
      };
    }
  }

  private addLeumiFromEnv(banks: Record<string, BankConfig>): void {
    if (process.env.LEUMI_USERNAME) {
      const accounts = process.env.LEUMI_ACCOUNTS || 'all';
      banks.leumi = {
        username: process.env.LEUMI_USERNAME,
        password: process.env.LEUMI_PASSWORD,
        startDate: process.env.LEUMI_START_DATE,
        targets: [{
          actualAccountId: process.env.LEUMI_ACCOUNT_ID || '',
          reconcile: process.env.LEUMI_RECONCILE === 'true',
          accounts: accounts === 'all' ? 'all' : accounts.split(',')
        }]
      };
    }
  }

  private addHapoalimFromEnv(banks: Record<string, BankConfig>): void {
    if (process.env.HAPOALIM_USER_CODE) {
      const accounts = process.env.HAPOALIM_ACCOUNTS || 'all';
      banks.hapoalim = {
        userCode: process.env.HAPOALIM_USER_CODE,
        password: process.env.HAPOALIM_PASSWORD,
        startDate: process.env.HAPOALIM_START_DATE,
        targets: [{
          actualAccountId: process.env.HAPOALIM_ACCOUNT_ID || '',
          reconcile: process.env.HAPOALIM_RECONCILE === 'true',
          accounts: accounts === 'all' ? 'all' : accounts.split(',')
        }]
      };
    }
  }

  private validate(config: ImporterConfig): void {
    // Validate Actual Budget configuration
    if (!config.actual.init.password) {
      throw new ConfigurationError('ACTUAL_PASSWORD is required (set via environment variable or config.json)');
    }

    if (!config.actual.budget.syncId) {
      throw new ConfigurationError('ACTUAL_BUDGET_SYNC_ID is required (set via environment variable or config.json)');
    }

    // Validate syncId format (should be UUID)
    if (!this.isValidUUID(config.actual.budget.syncId)) {
      throw new ConfigurationError(`Invalid ACTUAL_BUDGET_SYNC_ID format. Expected UUID, got: ${config.actual.budget.syncId}`);
    }

    // Validate serverURL format
    if (!config.actual.init.serverURL.startsWith('http://') && !config.actual.init.serverURL.startsWith('https://')) {
      throw new ConfigurationError(`Invalid serverURL format. Must start with http:// or https://, got: ${config.actual.init.serverURL}`);
    }

    // Validate at least one bank is configured
    if (Object.keys(config.banks).length === 0) {
      throw new ConfigurationError('No bank credentials configured. Please set environment variables or use config.json');
    }

    // Validate each bank configuration
    for (const [bankName, bankConfig] of Object.entries(config.banks)) {
      this.validateBank(bankName, bankConfig);
    }

    // Validate notifications (optional)
    if (config.notifications?.enabled) {
      this.validateNotifications(config.notifications);
    }
  }

  private validateNotifications(config: import('../types/index.js').NotificationConfig): void {
    if (config.telegram) {
      if (!config.telegram.botToken) {
        throw new ConfigurationError('Telegram botToken is required when telegram notifications are configured');
      }
      if (!/^\d+:.+$/.test(config.telegram.botToken)) {
        throw new ConfigurationError('Invalid Telegram botToken format. Expected format: "123456789:ABCdef..."');
      }
      if (!config.telegram.chatId) {
        throw new ConfigurationError('Telegram chatId is required when telegram notifications are configured');
      }
      const validFormats = ['summary', 'compact', 'ledger', 'emoji'];
      if (config.telegram.messageFormat && !validFormats.includes(config.telegram.messageFormat)) {
        throw new ConfigurationError(`Invalid messageFormat "${config.telegram.messageFormat}". Must be one of: ${validFormats.join(', ')}`);
      }
      const validShow = ['new', 'all', 'none'];
      if (config.telegram.showTransactions && !validShow.includes(config.telegram.showTransactions)) {
        throw new ConfigurationError(`Invalid showTransactions "${config.telegram.showTransactions}". Must be one of: ${validShow.join(', ')}`);
      }
    }
  }

  private isValidUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  private validateBank(bankName: string, config: BankConfig): void {
    // Validate startDate and daysBack are mutually exclusive
    if (config.startDate && config.daysBack) {
      throw new ConfigurationError(
        `${bankName}: cannot use both "startDate" and "daysBack". Choose one.`
      );
    }

    // Validate daysBack if present
    if (config.daysBack !== undefined) {
      if (!Number.isInteger(config.daysBack) || config.daysBack < 1 || config.daysBack > 30) {
        throw new ConfigurationError(
          `${bankName}: "daysBack" must be an integer between 1 and 30. Got: ${config.daysBack}`
        );
      }
    }

    // Validate startDate if present
    if (config.startDate) {
      const date = new Date(config.startDate);
      if (isNaN(date.getTime())) {
        throw new ConfigurationError(
          `Invalid startDate format for ${bankName}: "${config.startDate}". Expected YYYY-MM-DD format (e.g., "2026-02-15")`
        );
      }
      if (date > new Date()) {
        throw new ConfigurationError(
          `startDate cannot be in the future for ${bankName}. Got: ${config.startDate}`
        );
      }
      // Reject if more than 1 year ago
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      if (date < oneYearAgo) {
        throw new ConfigurationError(
          `${bankName}: startDate cannot be more than 1 year ago. Got: ${config.startDate}`
        );
      }
    }

    // Validate targets array exists and not empty
    if (!config.targets || config.targets.length === 0) {
      throw new ConfigurationError(`No targets configured for ${bankName}. At least one target is required.`);
    }

    // Validate each target
    config.targets.forEach((target, idx) => {
      // Validate actualAccountId format (UUID)
      if (!target.actualAccountId) {
        throw new ConfigurationError(`Missing actualAccountId for ${bankName} target ${idx}`);
      }
      if (!this.isValidUUID(target.actualAccountId)) {
        throw new ConfigurationError(
          `Invalid actualAccountId format for ${bankName} target ${idx}.\n` +
          `  Expected: UUID format (e.g., "12345678-1234-1234-1234-123456789abc")\n` +
          `  Got: "${target.actualAccountId}"`
        );
      }

      // Validate accounts field
      if (!target.accounts) {
        throw new ConfigurationError(`Missing accounts field for ${bankName} target ${idx}. Use "all" or an array of account numbers.`);
      }
      if (target.accounts !== 'all' && (!Array.isArray(target.accounts) || target.accounts.length === 0)) {
        throw new ConfigurationError(`Invalid accounts field for ${bankName} target ${idx}. Must be "all" or a non-empty array.`);
      }

      // Validate reconcile is boolean
      if (typeof target.reconcile !== 'boolean') {
        throw new ConfigurationError(`Invalid reconcile field for ${bankName} target ${idx}. Must be true or false.`);
      }
    });

    // Bank-specific validation
    this.validateBankCredentials(bankName, config);
  }

  private validateBankCredentials(bankName: string, config: BankConfig): void {
    const lowerName = bankName.toLowerCase();

    // Validate email format if present
    if (config.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(config.email)) {
        throw new ConfigurationError(`Invalid email format for ${bankName}: "${config.email}"`);
      }
    }

    // Validate phone format if present (basic validation)
    if (config.phoneNumber) {
      const phoneRegex = /^\+?\d{10,15}$/;
      if (!phoneRegex.test(config.phoneNumber.replace(/[\s-]/g, ''))) {
        throw new ConfigurationError(`Invalid phone number format for ${bankName}: "${config.phoneNumber}". Expected 10-15 digits.`);
      }
    }

    // Validate card6Digits format if present
    if (config.card6Digits) {
      if (!/^\d{6}$/.test(config.card6Digits)) {
        throw new ConfigurationError(`Invalid card6Digits format for ${bankName}: "${config.card6Digits}". Expected 6 digits.`);
      }
    }

    // Bank-specific required fields
    if (lowerName === 'discount') {
      if (!config.id || !config.password || !config.num) {
        throw new ConfigurationError(`Discount bank requires: id, password, num. Missing: ${!config.id ? 'id ' : ''}${!config.password ? 'password ' : ''}${!config.num ? 'num' : ''}`);
      }
    } else if (lowerName === 'leumi' || lowerName === 'union') {
      if (!config.username || !config.password) {
        throw new ConfigurationError(`${bankName} requires: username, password`);
      }
    } else if (lowerName === 'hapoalim') {
      if (!config.userCode || !config.password) {
        throw new ConfigurationError(`Hapoalim requires: userCode, password`);
      }
    } else if (lowerName === 'yahav') {
      if (!config.nationalID || !config.password) {
        throw new ConfigurationError(`Yahav requires: nationalID, password`);
      }
    } else if (lowerName === 'onezero') {
      if (!config.email || !config.password || !config.phoneNumber) {
        throw new ConfigurationError(`OneZero requires: email, password, phoneNumber`);
      }
    }
  }
}
