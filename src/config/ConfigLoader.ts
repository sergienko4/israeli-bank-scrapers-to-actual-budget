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
    if (!config.actual.init.password) {
      throw new ConfigurationError('ACTUAL_PASSWORD is required (set via environment variable or config.json)');
    }

    if (!config.actual.budget.syncId) {
      throw new ConfigurationError('ACTUAL_BUDGET_SYNC_ID is required (set via environment variable or config.json)');
    }

    if (Object.keys(config.banks).length === 0) {
      throw new ConfigurationError('No bank credentials configured. Please set environment variables or use config.json');
    }
  }
}
