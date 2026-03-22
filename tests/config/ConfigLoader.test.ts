import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigLoader } from '../../src/Config/ConfigLoader.js';
import * as fs from 'fs';
import { faker } from '@faker-js/faker';
import { TEST_CREDENTIAL } from '../helpers/testCredentials.js';
import { isSuccess, isFail } from '../../src/Types/Index.js';

vi.mock('fs');

// UUID is asserted in tests like "expect(result.data.actual.budget.syncId).toBe(VALID_UUID)"
const VALID_UUID = '12345678-1234-1234-1234-123456789abc';

/** Default target used across bank configs in tests. */
const DEFAULT_TARGET = { actualAccountId: VALID_UUID, reconcile: true, accounts: 'all' };

/**
 * Environment variable names cleaned up after env-based tests.
 */
const ENV_KEYS_TO_CLEAN = [
  'ACTUAL_PASSWORD', 'ACTUAL_BUDGET_SYNC_ID',
  'DISCOUNT_ID', 'DISCOUNT_PASSWORD', 'DISCOUNT_NUM',
  'DISCOUNT_ACCOUNT_ID', 'DISCOUNT_ACCOUNTS',
  'LEUMI_USERNAME', 'LEUMI_PASSWORD', 'LEUMI_ACCOUNT_ID', 'LEUMI_ACCOUNTS',
  'HAPOALIM_USER_CODE', 'HAPOALIM_PASSWORD', 'HAPOALIM_ACCOUNT_ID', 'HAPOALIM_ACCOUNTS',
] as const;

/**
 * Builds a valid config object with optional overrides.
 *
 * @param overrides - Partial fields to override in the generated config.
 * @returns A complete config object suitable for ConfigLoader.
 */
function makeValidConfig(overrides: Record<string, unknown> = {}) {
  const init = (overrides.init as Record<string, unknown> | undefined) ?? {};
  const budget = (overrides.budget as Record<string, unknown> | undefined) ?? {};
  return {
    actual: {
      init: {
        dataDir: './data',
        password: faker.internet.password({ length: 12 }),
        serverURL: 'http://localhost:5006',
        ...init,
      },
      budget: {
        syncId: VALID_UUID,
        password: null,
        ...budget,
      },
    },
    banks: (overrides.banks as Record<string, unknown> | undefined) ?? {
      discount: {
        id: faker.string.numeric(9),
        password: faker.internet.password({ length: 12 }),
        num: faker.string.alphanumeric(6).toUpperCase(),
        targets: [DEFAULT_TARGET],
      },
    },
  };
}

/**
 * Mocks fs to return the given config object from a file read.
 *
 * @param config - The config object to serialize and return from readFileSync.
 */
function mockFileConfig(config: ReturnType<typeof makeValidConfig>): void {
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));
}

/**
 * Builds a config with overrides, mocks fs, and asserts that loading fails.
 *
 * @param overrides - Partial fields to override in the generated config.
 * @param message - Expected error message substring.
 */
function expectConfigToFail(overrides: Record<string, unknown>, message: string): void {
  const config = makeValidConfig(overrides);
  mockFileConfig(config);
  const loader = new ConfigLoader('/test/config.json');
  const result = loader.load();
  expect(result.success).toBe(false);
  if (!isFail(result)) return;
  expect(result.message).toContain(message);
}

/**
 * Builds a config with overrides, mocks fs, and asserts that loading succeeds.
 *
 * @param overrides - Partial fields to override in the generated config.
 */
function expectConfigToSucceed(overrides: Record<string, unknown>): void {
  const config = makeValidConfig(overrides);
  mockFileConfig(config);
  const loader = new ConfigLoader('/test/config.json');
  const result = loader.load();
  expect(result.success).toBe(true);
}

/**
 * Sets the base Actual Budget environment variables required for env-based loading.
 */
function setBaseEnvVars(): void {
  process.env.ACTUAL_PASSWORD = TEST_CREDENTIAL;
  process.env.ACTUAL_BUDGET_SYNC_ID = VALID_UUID;
}

/**
 * Sets discount bank environment variables for env-based config loading tests.
 */
function setDiscountEnvVars(): void {
  setBaseEnvVars();
  process.env.DISCOUNT_ID = '123';
  process.env.DISCOUNT_PASSWORD = TEST_CREDENTIAL;
  process.env.DISCOUNT_NUM = 'ABC';
  process.env.DISCOUNT_ACCOUNT_ID = VALID_UUID;
}

/**
 * Clears all bank-related environment variables after env-based tests.
 */
function clearAllEnvVars(): void {
  for (const key of ENV_KEYS_TO_CLEAN) {
    delete process.env[key];
  }
}

/**
 * Builds a bank config entry with the given credentials and default target.
 *
 * @param creds - Credential fields for the bank.
 * @returns A bank config object with credentials and default target.
 */
function makeBankWithTarget(creds: Record<string, unknown>) {
  return { ...creds, targets: [DEFAULT_TARGET] };
}

describe('ConfigLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('file loading', () => {
    it('loads valid config from file', () => {
      const validConfig = makeValidConfig();
      mockFileConfig(validConfig);

      const loader = new ConfigLoader('/test/config.json');
      const result = loader.load();

      expect(result.success).toBe(true);
      if (!isSuccess(result)) return;
      expect(result.data.actual.budget.syncId).toBe(VALID_UUID);
      expect(result.data.banks.discount).toBeDefined();
    });

    it('falls back to env vars when config file not found', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      setDiscountEnvVars();

      const loader = new ConfigLoader('/nonexistent/config.json');
      const result = loader.load();

      expect(result.success).toBe(true);
      if (!isSuccess(result)) return;
      expect(result.data.actual.init.password).toBe(TEST_CREDENTIAL);
      expect(result.data.banks.discount).toBeDefined();

      clearAllEnvVars();
    });

    it('returns failure on invalid JSON (does not fall back to env)', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('not valid json{{{');
      setDiscountEnvVars();

      const loader = new ConfigLoader('/test/config.json');
      const result = loader.load();

      expect(result.success).toBe(false);
      if (!isFail(result)) return;
      expect(result.message).toContain('Failed to parse /test/config.json');

      clearAllEnvVars();
    });

    it('returns failure for invalid syncId from file loading', () => {
      const invalidConfig = makeValidConfig({ budget: { syncId: 'not-a-uuid', password: null } });
      mockFileConfig(invalidConfig);

      const loader = new ConfigLoader('/test/config.json');
      const result = loader.load();

      expect(result.success).toBe(false);
      if (!isFail(result)) return;
      expect(result.message).toContain('ACTUAL_BUDGET_SYNC_ID');
    });

    it('uses default path when none provided', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      setDiscountEnvVars();

      const loader = new ConfigLoader();
      loader.load();

      expect(fs.existsSync).toHaveBeenCalledWith('/app/config.json');

      clearAllEnvVars();
    });
  });

  describe('validation - actual config', () => {
    it('fails on missing password', () => {
      expectConfigToFail({ init: { password: '' } }, 'ACTUAL_PASSWORD is required');
    });

    it('fails on missing syncId', () => {
      expectConfigToFail({ budget: { syncId: '', password: null } }, 'ACTUAL_BUDGET_SYNC_ID is required');
    });

    it('fails on invalid syncId UUID format', () => {
      expectConfigToFail({ budget: { syncId: 'invalid-uuid', password: null } }, 'Invalid ACTUAL_BUDGET_SYNC_ID format');
    });

    it('fails on invalid serverURL format', () => {
      expectConfigToFail({ init: { serverURL: 'ftp://invalid' } }, 'Invalid serverURL format');
    });

    it('accepts https serverURL', () => {
      expectConfigToSucceed({ init: { serverURL: 'https://actual.example.com' } });
    });
  });

  describe('validation - bank config', () => {
    it('fails when no banks configured', () => {
      expectConfigToFail({ banks: {} }, 'No bank credentials configured');
    });

    it('fails on invalid startDate format', () => {
      expectConfigToFail({
        banks: {
          discount: makeBankWithTarget({
            id: '123', password: TEST_CREDENTIAL, num: 'ABC',
            startDate: 'not-a-date',
          }),
        },
      }, 'Invalid startDate for');
    });

    it('fails on future startDate', () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);

      expectConfigToFail({
        banks: {
          discount: makeBankWithTarget({
            id: '123', password: TEST_CREDENTIAL, num: 'ABC',
            startDate: futureDate.toISOString().split('T')[0],
          }),
        },
      }, 'cannot be in the future');
    });

    it('fails on startDate more than 1 year ago', () => {
      const oldDate = new Date();
      oldDate.setFullYear(oldDate.getFullYear() - 2);

      expectConfigToFail({
        banks: {
          discount: makeBankWithTarget({
            id: '123', password: TEST_CREDENTIAL, num: 'ABC',
            startDate: oldDate.toISOString().split('T')[0],
          }),
        },
      }, 'startDate too old');
    });

    it('fails on missing targets', () => {
      expectConfigToFail({
        banks: {
          discount: { id: '123', password: TEST_CREDENTIAL, num: 'ABC' },
        },
      }, 'No targets configured');
    });

    it('fails on empty targets array', () => {
      expectConfigToFail({
        banks: {
          discount: { id: '123', password: TEST_CREDENTIAL, num: 'ABC', targets: [] },
        },
      }, 'No targets configured');
    });

    it('fails on missing actualAccountId', () => {
      expectConfigToFail({
        banks: {
          discount: {
            id: '123', password: TEST_CREDENTIAL, num: 'ABC',
            targets: [{ actualAccountId: '', reconcile: true, accounts: 'all' }],
          },
        },
      }, 'Missing actualAccountId');
    });

    it('fails on invalid actualAccountId UUID', () => {
      expectConfigToFail({
        banks: {
          discount: {
            id: '123', password: TEST_CREDENTIAL, num: 'ABC',
            targets: [{ actualAccountId: 'not-uuid', reconcile: true, accounts: 'all' }],
          },
        },
      }, 'Invalid actualAccountId format');
    });

    it('fails on missing accounts field', () => {
      const config = {
        actual: {
          init: { dataDir: './data', password: TEST_CREDENTIAL, serverURL: 'http://localhost:5006' },
          budget: { syncId: VALID_UUID, password: null },
        },
        banks: {
          discount: {
            id: '123', password: TEST_CREDENTIAL, num: 'ABC',
            targets: [{ actualAccountId: VALID_UUID, reconcile: true }],
          },
        },
      };
      mockFileConfig(config as ReturnType<typeof makeValidConfig>);

      const loader = new ConfigLoader('/test/config.json');
      const result = loader.load();
      expect(result.success).toBe(false);
      if (!isFail(result)) return;
      expect(result.message).toContain('Invalid accounts for');
    });

    it('fails on invalid reconcile type', () => {
      const config = {
        actual: {
          init: { dataDir: './data', password: TEST_CREDENTIAL, serverURL: 'http://localhost:5006' },
          budget: { syncId: VALID_UUID, password: null },
        },
        banks: {
          discount: {
            id: '123', password: TEST_CREDENTIAL, num: 'ABC',
            targets: [{ actualAccountId: VALID_UUID, reconcile: 'yes', accounts: 'all' }],
          },
        },
      };
      mockFileConfig(config as ReturnType<typeof makeValidConfig>);

      const loader = new ConfigLoader('/test/config.json');
      const result = loader.load();
      expect(result.success).toBe(false);
      if (!isFail(result)) return;
      expect(result.message).toContain('Invalid reconcile for');
    });

    it('accepts accounts as array', () => {
      expectConfigToSucceed({
        banks: {
          discount: {
            id: '123', password: TEST_CREDENTIAL, num: 'ABC',
            targets: [{ actualAccountId: VALID_UUID, reconcile: true, accounts: ['1234', '5678'] }],
          },
        },
      });
    });
  });

  describe('bank-specific credential validation', () => {
    it.each([
      ['discount', { password: TEST_CREDENTIAL, num: 'ABC' }, 'Discount bank requires'],
      ['leumi', { password: TEST_CREDENTIAL }, 'leumi requires: username, password'],
      ['hapoalim', { password: TEST_CREDENTIAL }, 'Hapoalim requires: userCode, password'],
      ['yahav', { password: TEST_CREDENTIAL }, 'Yahav requires: nationalID, password'],
      ['oneZero', { password: TEST_CREDENTIAL, phoneNumber: '0501234567' }, 'OneZero requires: email, password, phoneNumber'],
      ['max', { username: 'user', password: TEST_CREDENTIAL }, 'Max requires: username, password, id'],
    ])('fails when %s is missing required credentials', (bankName, creds, message) => {
      expectConfigToFail({
        banks: { [bankName]: makeBankWithTarget(creds as Record<string, unknown>) },
      }, message);
    });

    it('validates email format', () => {
      expectConfigToFail({
        banks: {
          oneZero: makeBankWithTarget({
            email: 'not-an-email', password: TEST_CREDENTIAL, phoneNumber: '0501234567890',
          }),
        },
      }, 'Invalid email format');
    });

    it('validates phone number format', () => {
      expectConfigToFail({
        banks: {
          oneZero: makeBankWithTarget({
            email: 'user@example.com', password: TEST_CREDENTIAL, phoneNumber: '123',
          }),
        },
      }, 'Invalid phone number format');
    });

    it('validates card6Digits format', () => {
      expectConfigToFail({
        banks: {
          isracard: makeBankWithTarget({
            id: '123456789', card6Digits: '12345', password: TEST_CREDENTIAL,
          }),
        },
      }, 'Invalid card6Digits format');
    });

    it('accepts valid card6Digits', () => {
      expectConfigToSucceed({
        banks: {
          isracard: makeBankWithTarget({
            id: '123456789', card6Digits: '123456', password: TEST_CREDENTIAL,
          }),
        },
      });
    });
  });

  describe('environment variable loading - account splitting', () => {
    afterEach(() => {
      clearAllEnvVars();
    });

    it('splits comma-separated LEUMI_ACCOUNTS into array', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      setBaseEnvVars();
      process.env.LEUMI_USERNAME = 'user';
      process.env.LEUMI_PASSWORD = TEST_CREDENTIAL;
      process.env.LEUMI_ACCOUNT_ID = VALID_UUID;
      process.env.LEUMI_ACCOUNTS = '1234,5678';

      const loader = new ConfigLoader('/nonexistent');
      const result = loader.load();

      expect(result.success).toBe(true);
      if (!isSuccess(result)) return;
      expect(result.data.banks.leumi?.targets?.[0].accounts).toEqual(['1234', '5678']);
    });

    it('splits comma-separated HAPOALIM_ACCOUNTS into array', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      setBaseEnvVars();
      process.env.HAPOALIM_USER_CODE = 'code';
      process.env.HAPOALIM_PASSWORD = TEST_CREDENTIAL;
      process.env.HAPOALIM_ACCOUNT_ID = VALID_UUID;
      process.env.HAPOALIM_ACCOUNTS = '111,222,333';

      const loader = new ConfigLoader('/nonexistent');
      const result = loader.load();

      expect(result.success).toBe(true);
      if (!isSuccess(result)) return;
      expect(result.data.banks.hapoalim?.targets?.[0].accounts).toEqual(['111', '222', '333']);
    });

    it('splits comma-separated DISCOUNT_ACCOUNTS into array', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      setDiscountEnvVars();
      process.env.DISCOUNT_ACCOUNTS = '9999,8888';

      const loader = new ConfigLoader('/nonexistent');
      const result = loader.load();

      expect(result.success).toBe(true);
      if (!isSuccess(result)) return;
      expect(result.data.banks.discount?.targets?.[0].accounts).toEqual(['9999', '8888']);
    });

    it('uses "all" as default for LEUMI_ACCOUNTS', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      setBaseEnvVars();
      process.env.LEUMI_USERNAME = 'user';
      process.env.LEUMI_PASSWORD = TEST_CREDENTIAL;
      process.env.LEUMI_ACCOUNT_ID = VALID_UUID;

      const loader = new ConfigLoader('/nonexistent');
      const result = loader.load();

      expect(result.success).toBe(true);
      if (!isSuccess(result)) return;
      expect(result.data.banks.leumi?.targets?.[0].accounts).toBe('all');
    });
  });

  describe('validation - empty accounts array', () => {
    it('fails on empty array accounts', () => {
      expectConfigToFail({
        banks: {
          discount: {
            id: '123', password: TEST_CREDENTIAL, num: 'ABC',
            targets: [{ actualAccountId: VALID_UUID, reconcile: true, accounts: [] }],
          },
        },
      }, 'Invalid accounts for');
    });
  });

  describe('webhook validation', () => {
    it('accepts valid webhook config', () => {
      const config = makeValidConfig();
      config.notifications = { enabled: true, webhook: { url: 'https://hooks.slack.com/test', format: 'slack' } };
      mockFileConfig(config);
      const result = new ConfigLoader('/test/config.json').load();
      expect(result.success).toBe(true);
    });

    it.each([
      [{ url: '', format: 'plain' }, 'Webhook url is required'],
      [{ url: 'ftp://bad.com', format: 'plain' }, 'Invalid webhook url format'],
      [{ url: 'https://example.com', format: 'invalid' }, 'Invalid webhook format'],
    ])('fails on invalid webhook config: %s', (webhook, message) => {
      const config = makeValidConfig();
      config.notifications = { enabled: true, webhook };
      mockFileConfig(config);
      const result = new ConfigLoader('/test/config.json').load();
      expect(result.success).toBe(false);
      if (!isFail(result)) return;
      expect(result.message).toContain(message);
    });
  });

  describe('split config (credentials.json + config.json)', () => {
    it('merges credentials.json into config.json', () => {
      const settings = { actual: { init: { serverURL: 'http://localhost:5006', dataDir: './data' } }, banks: { discount: { daysBack: 14, targets: [DEFAULT_TARGET] } } };
      const credentials = { actual: { init: { password: TEST_CREDENTIAL }, budget: { syncId: VALID_UUID, password: null } }, banks: { discount: { id: '123', password: TEST_CREDENTIAL, num: 'ABC' } } };

      vi.mocked(fs.existsSync).mockImplementation((p) => String(p).includes('config.json') || String(p).includes('credentials.json'));
      vi.mocked(fs.readFileSync).mockImplementation((p) => String(p).includes('credentials') ? JSON.stringify(credentials) : JSON.stringify(settings));

      const result = new ConfigLoader('/test/config.json').load();
      expect(result.success).toBe(true);
      if (!isSuccess(result)) return;
      expect(result.data.actual.init.password).toBe(TEST_CREDENTIAL);
      expect(result.data.actual.init.serverURL).toBe('http://localhost:5006');
      expect(result.data.banks.discount.id).toBe('123');
      expect(result.data.banks.discount.daysBack).toBe(14);
    });

    it('works without credentials.json (backward compatible)', () => {
      const fullConfig = makeValidConfig();
      vi.mocked(fs.existsSync).mockImplementation((p) => String(p).includes('config.json'));
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(fullConfig));

      const result = new ConfigLoader('/test/config.json').load();
      expect(result.success).toBe(true);
      if (!isSuccess(result)) return;
      expect(result.data.banks.discount.password).toBe(fullConfig.banks.discount.password);
    });

    it('deep merges bank settings with bank credentials', () => {
      const settings = { actual: { init: { serverURL: 'http://localhost:5006', password: TEST_CREDENTIAL, dataDir: './data' }, budget: { syncId: VALID_UUID, password: null } }, banks: { discount: { daysBack: 7, targets: [{ actualAccountId: VALID_UUID, reconcile: false, accounts: 'all' }] } } };
      const credentials = { banks: { discount: { id: '999', password: TEST_CREDENTIAL, num: 'XYZ' } } };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation((p) => String(p).includes('credentials') ? JSON.stringify(credentials) : JSON.stringify(settings));

      const result = new ConfigLoader('/test/config.json').load();
      expect(result.success).toBe(true);
      if (!isSuccess(result)) return;
      expect(result.data.banks.discount.id).toBe('999');
      expect(result.data.banks.discount.password).toBe(TEST_CREDENTIAL);
      expect(result.data.banks.discount.daysBack).toBe(7);
      expect(result.data.banks.discount.targets).toHaveLength(1);
    });

    it('credentials override conflicting config values', () => {
      const settings = makeValidConfig();
      const credentials = { actual: { init: { password: TEST_CREDENTIAL } } };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation((p) => String(p).includes('credentials') ? JSON.stringify(credentials) : JSON.stringify(settings));

      const result = new ConfigLoader('/test/config.json').load();
      expect(result.success).toBe(true);
      if (!isSuccess(result)) return;
      expect(result.data.actual.init.password).toBe(TEST_CREDENTIAL);
    });
  });

  describe('proxy validation', () => {
    it.each([
      ['socks5://localhost:1080'],
      ['http://proxy.example.com:8080'],
    ])('accepts valid proxy: %s', (server) => {
      const config = makeValidConfig();
      config.proxy = { server };
      mockFileConfig(config);
      const result = new ConfigLoader('/test/config.json').load();
      expect(result.success).toBe(true);
    });

    it.each([
      [{ server: 'invalid://bad' }, 'Invalid proxy.server format'],
      [{ server: '' }, 'proxy.server is required'],
    ])('fails on invalid proxy config: %s', (proxy, message) => {
      const config = makeValidConfig();
      config.proxy = proxy;
      mockFileConfig(config);
      const result = new ConfigLoader('/test/config.json').load();
      expect(result.success).toBe(false);
      if (!isFail(result)) return;
      expect(result.message).toContain(message);
    });

    it('applies PROXY_SERVER env var override', () => {
      const config = makeValidConfig();
      mockFileConfig(config);
      process.env.PROXY_SERVER = 'socks5://env-proxy:1080';
      const result = new ConfigLoader('/test/config.json').load();
      expect(result.success).toBe(true);
      if (!isSuccess(result)) return;
      expect(result.data.proxy?.server).toBe('socks5://env-proxy:1080');
      delete process.env.PROXY_SERVER;
    });
  });

});
