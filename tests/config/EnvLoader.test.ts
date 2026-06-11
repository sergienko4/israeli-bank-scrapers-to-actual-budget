import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import loadFromEnvironment from '../../src/Config/Loaders/EnvLoader.js';

/**
 * Environment variable names cleaned up after each test.
 */
const ENV_KEYS_TO_CLEAN = [
  'ACTUAL_DATA_DIR', 'ACTUAL_PASSWORD', 'ACTUAL_SERVER_URL',
  'ACTUAL_BUDGET_SYNC_ID', 'ACTUAL_BUDGET_PASSWORD',
  'DISCOUNT_ID', 'DISCOUNT_PASSWORD', 'DISCOUNT_NUM',
  'DISCOUNT_START_DATE', 'DISCOUNT_ACCOUNT_ID',
  'DISCOUNT_ACCOUNTS', 'DISCOUNT_RECONCILE',
  'LEUMI_USERNAME', 'LEUMI_PASSWORD',
  'LEUMI_START_DATE', 'LEUMI_ACCOUNT_ID',
  'LEUMI_ACCOUNTS', 'LEUMI_RECONCILE',
  'HAPOALIM_USER_CODE', 'HAPOALIM_PASSWORD',
  'HAPOALIM_START_DATE', 'HAPOALIM_ACCOUNT_ID',
  'HAPOALIM_ACCOUNTS', 'HAPOALIM_RECONCILE',
] as const;

/**
 * Stores original env vars so tests can clean them up deterministically.
 */
const originalEnv: Record<string, string | undefined> = {};

describe('EnvLoader', () => {
  beforeEach(() => {
    for (const key of ENV_KEYS_TO_CLEAN) {
      originalEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS_TO_CLEAN) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  describe('actual block defaults', () => {
    it('defaults dataDir to ./data when ACTUAL_DATA_DIR is unset', () => {
      const config = loadFromEnvironment();
      expect(config.actual.init.dataDir).toBe('./data');
    });

    it('defaults serverURL to http://actual_server:5006 when unset', () => {
      const config = loadFromEnvironment();
      expect(config.actual.init.serverURL).toBe('http://actual_server:5006');
    });

    it('defaults password to empty string when ACTUAL_PASSWORD is unset', () => {
      const config = loadFromEnvironment();
      expect(config.actual.init.password).toBe('');
    });

    it('defaults budget.password to null when ACTUAL_BUDGET_PASSWORD is unset', () => {
      const config = loadFromEnvironment();
      expect(config.actual.budget.password).toBeNull();
    });

    it('reads ACTUAL_DATA_DIR from env when set', () => {
      process.env.ACTUAL_DATA_DIR = '/custom/data';
      const config = loadFromEnvironment();
      expect(config.actual.init.dataDir).toBe('/custom/data');
    });

    it('reads ACTUAL_SERVER_URL from env when set', () => {
      process.env.ACTUAL_SERVER_URL = 'https://example.com';
      const config = loadFromEnvironment();
      expect(config.actual.init.serverURL).toBe('https://example.com');
    });

    it('reads ACTUAL_BUDGET_SYNC_ID from env when set', () => {
      process.env.ACTUAL_BUDGET_SYNC_ID = 'sync-123';
      const config = loadFromEnvironment();
      expect(config.actual.budget.syncId).toBe('sync-123');
    });
  });

  describe('bank entries', () => {
    it('omits all banks when no marker env vars are set', () => {
      const config = loadFromEnvironment();
      expect(config.banks).toEqual({});
    });

    it('adds discount when DISCOUNT_ID is set', () => {
      process.env.DISCOUNT_ID = '123456789';
      process.env.DISCOUNT_PASSWORD = 'pw';
      const config = loadFromEnvironment();
      expect(config.banks.discount).toEqual({
        id: '123456789',
        password: 'pw',
        num: undefined,
        startDate: undefined,
        targets: [{ actualAccountId: '', reconcile: false, accounts: 'all' }],
      });
    });

    it('skips discount when DISCOUNT_ID is missing', () => {
      process.env.DISCOUNT_PASSWORD = 'pw';
      const config = loadFromEnvironment();
      expect(config.banks.discount).toBeUndefined();
    });

    it('adds leumi when LEUMI_USERNAME is set', () => {
      process.env.LEUMI_USERNAME = 'me';
      process.env.LEUMI_PASSWORD = 'pw';
      const config = loadFromEnvironment();
      expect(config.banks.leumi).toEqual({
        username: 'me',
        password: 'pw',
        startDate: undefined,
        targets: [{ actualAccountId: '', reconcile: false, accounts: 'all' }],
      });
    });

    it('skips leumi when LEUMI_USERNAME is missing', () => {
      process.env.LEUMI_PASSWORD = 'pw';
      const config = loadFromEnvironment();
      expect(config.banks.leumi).toBeUndefined();
    });

    it('adds hapoalim when HAPOALIM_USER_CODE is set', () => {
      process.env.HAPOALIM_USER_CODE = 'uc';
      process.env.HAPOALIM_PASSWORD = 'pw';
      const config = loadFromEnvironment();
      expect(config.banks.hapoalim).toEqual({
        userCode: 'uc',
        password: 'pw',
        startDate: undefined,
        targets: [{ actualAccountId: '', reconcile: false, accounts: 'all' }],
      });
    });

    it('skips hapoalim when HAPOALIM_USER_CODE is missing', () => {
      process.env.HAPOALIM_PASSWORD = 'pw';
      const config = loadFromEnvironment();
      expect(config.banks.hapoalim).toBeUndefined();
    });

    it('combines multiple banks when their markers are set', () => {
      process.env.DISCOUNT_ID = 'd-id';
      process.env.LEUMI_USERNAME = 'l-user';
      process.env.HAPOALIM_USER_CODE = 'h-uc';
      const config = loadFromEnvironment();
      expect(Object.keys(config.banks).sort()).toEqual(['discount', 'hapoalim', 'leumi']);
    });
  });

  describe('target accounts parsing', () => {
    it('parses comma-separated DISCOUNT_ACCOUNTS into an array', () => {
      process.env.DISCOUNT_ID = 'd-id';
      process.env.DISCOUNT_ACCOUNTS = 'a,b,c';
      const config = loadFromEnvironment();
      expect(config.banks.discount?.targets?.[0]?.accounts).toEqual(['a', 'b', 'c']);
    });

    it('keeps "all" literal when DISCOUNT_ACCOUNTS equals "all"', () => {
      process.env.DISCOUNT_ID = 'd-id';
      process.env.DISCOUNT_ACCOUNTS = 'all';
      const config = loadFromEnvironment();
      expect(config.banks.discount?.targets?.[0]?.accounts).toBe('all');
    });

    it('defaults to "all" when DISCOUNT_ACCOUNTS is unset', () => {
      process.env.DISCOUNT_ID = 'd-id';
      const config = loadFromEnvironment();
      expect(config.banks.discount?.targets?.[0]?.accounts).toBe('all');
    });

    it('sets reconcile=true when DISCOUNT_RECONCILE is "true"', () => {
      process.env.DISCOUNT_ID = 'd-id';
      process.env.DISCOUNT_RECONCILE = 'true';
      const config = loadFromEnvironment();
      expect(config.banks.discount?.targets?.[0]?.reconcile).toBe(true);
    });

    it('sets reconcile=false for any value other than "true"', () => {
      process.env.DISCOUNT_ID = 'd-id';
      process.env.DISCOUNT_RECONCILE = 'yes';
      const config = loadFromEnvironment();
      expect(config.banks.discount?.targets?.[0]?.reconcile).toBe(false);
    });

    it('reads actualAccountId from DISCOUNT_ACCOUNT_ID env', () => {
      process.env.DISCOUNT_ID = 'd-id';
      process.env.DISCOUNT_ACCOUNT_ID = 'acct-123';
      const config = loadFromEnvironment();
      expect(config.banks.discount?.targets?.[0]?.actualAccountId).toBe('acct-123');
    });
  });
});
