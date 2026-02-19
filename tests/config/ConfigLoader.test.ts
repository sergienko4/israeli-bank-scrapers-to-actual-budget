import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigLoader } from '../../src/config/ConfigLoader.js';
import { ConfigurationError } from '../../src/errors/ErrorTypes.js';
import * as fs from 'fs';

vi.mock('fs');

const VALID_UUID = '12345678-1234-1234-1234-123456789abc';

function makeValidConfig(overrides: any = {}) {
  return {
    actual: {
      init: {
        dataDir: './data',
        password: 'test123',
        serverURL: 'http://localhost:5006',
        ...overrides.init
      },
      budget: {
        syncId: VALID_UUID,
        password: null,
        ...overrides.budget
      }
    },
    banks: overrides.banks ?? {
      discount: {
        id: '123456789',
        password: 'pass',
        num: 'ABC123',
        targets: [{
          actualAccountId: VALID_UUID,
          reconcile: true,
          accounts: 'all'
        }]
      }
    }
  };
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
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(validConfig));

      const loader = new ConfigLoader('/test/config.json');
      const config = loader.load();

      expect(config.actual.budget.syncId).toBe(VALID_UUID);
      expect(config.banks.discount).toBeDefined();
    });

    it('falls back to env vars when config file not found', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Set env vars for a valid discount config
      process.env.ACTUAL_PASSWORD = 'test';
      process.env.ACTUAL_BUDGET_SYNC_ID = VALID_UUID;
      process.env.DISCOUNT_ID = '123';
      process.env.DISCOUNT_PASSWORD = 'pass';
      process.env.DISCOUNT_NUM = 'ABC';
      process.env.DISCOUNT_ACCOUNT_ID = VALID_UUID;

      const loader = new ConfigLoader('/nonexistent/config.json');
      const config = loader.load();

      expect(config.actual.init.password).toBe('test');
      expect(config.banks.discount).toBeDefined();

      // Cleanup
      delete process.env.ACTUAL_PASSWORD;
      delete process.env.ACTUAL_BUDGET_SYNC_ID;
      delete process.env.DISCOUNT_ID;
      delete process.env.DISCOUNT_PASSWORD;
      delete process.env.DISCOUNT_NUM;
      delete process.env.DISCOUNT_ACCOUNT_ID;
    });

    it('falls back to env vars on invalid JSON', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('not valid json{{{');

      process.env.ACTUAL_PASSWORD = 'test';
      process.env.ACTUAL_BUDGET_SYNC_ID = VALID_UUID;
      process.env.DISCOUNT_ID = '123';
      process.env.DISCOUNT_PASSWORD = 'pass';
      process.env.DISCOUNT_NUM = 'ABC';
      process.env.DISCOUNT_ACCOUNT_ID = VALID_UUID;

      const loader = new ConfigLoader('/test/config.json');
      const config = loader.load();

      expect(config.banks.discount).toBeDefined();

      delete process.env.ACTUAL_PASSWORD;
      delete process.env.ACTUAL_BUDGET_SYNC_ID;
      delete process.env.DISCOUNT_ID;
      delete process.env.DISCOUNT_PASSWORD;
      delete process.env.DISCOUNT_NUM;
      delete process.env.DISCOUNT_ACCOUNT_ID;
    });

    it('re-throws ConfigurationError from file loading', () => {
      const invalidConfig = makeValidConfig({ budget: { syncId: 'not-a-uuid', password: null } });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(invalidConfig));

      const loader = new ConfigLoader('/test/config.json');
      expect(() => loader.load()).toThrow(ConfigurationError);
    });

    it('uses default path when none provided', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // Will fail validation, but we can test the path is /app/config.json
      process.env.ACTUAL_PASSWORD = 'test';
      process.env.ACTUAL_BUDGET_SYNC_ID = VALID_UUID;
      process.env.DISCOUNT_ID = '123';
      process.env.DISCOUNT_PASSWORD = 'pass';
      process.env.DISCOUNT_NUM = 'ABC';
      process.env.DISCOUNT_ACCOUNT_ID = VALID_UUID;

      const loader = new ConfigLoader();
      loader.load();

      expect(fs.existsSync).toHaveBeenCalledWith('/app/config.json');

      delete process.env.ACTUAL_PASSWORD;
      delete process.env.ACTUAL_BUDGET_SYNC_ID;
      delete process.env.DISCOUNT_ID;
      delete process.env.DISCOUNT_PASSWORD;
      delete process.env.DISCOUNT_NUM;
      delete process.env.DISCOUNT_ACCOUNT_ID;
    });
  });

  describe('validation - actual config', () => {
    it('throws on missing password', () => {
      const config = makeValidConfig({ init: { password: '' } });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const loader = new ConfigLoader('/test/config.json');
      expect(() => loader.load()).toThrow('ACTUAL_PASSWORD is required');
    });

    it('throws on missing syncId', () => {
      const config = makeValidConfig({ budget: { syncId: '', password: null } });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const loader = new ConfigLoader('/test/config.json');
      expect(() => loader.load()).toThrow('ACTUAL_BUDGET_SYNC_ID is required');
    });

    it('throws on invalid syncId UUID format', () => {
      const config = makeValidConfig({ budget: { syncId: 'invalid-uuid', password: null } });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const loader = new ConfigLoader('/test/config.json');
      expect(() => loader.load()).toThrow('Invalid ACTUAL_BUDGET_SYNC_ID format');
    });

    it('throws on invalid serverURL format', () => {
      const config = makeValidConfig({ init: { serverURL: 'ftp://invalid' } });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const loader = new ConfigLoader('/test/config.json');
      expect(() => loader.load()).toThrow('Invalid serverURL format');
    });

    it('accepts https serverURL', () => {
      const config = makeValidConfig({ init: { serverURL: 'https://actual.example.com' } });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const loader = new ConfigLoader('/test/config.json');
      expect(() => loader.load()).not.toThrow();
    });
  });

  describe('validation - bank config', () => {
    it('throws when no banks configured', () => {
      const config = makeValidConfig({ banks: {} });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const loader = new ConfigLoader('/test/config.json');
      expect(() => loader.load()).toThrow('No bank credentials configured');
    });

    it('throws on invalid startDate format', () => {
      const config = makeValidConfig({
        banks: {
          discount: {
            id: '123', password: 'pass', num: 'ABC',
            startDate: 'not-a-date',
            targets: [{ actualAccountId: VALID_UUID, reconcile: true, accounts: 'all' }]
          }
        }
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const loader = new ConfigLoader('/test/config.json');
      expect(() => loader.load()).toThrow('Invalid startDate format');
    });

    it('throws on future startDate', () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);

      const config = makeValidConfig({
        banks: {
          discount: {
            id: '123', password: 'pass', num: 'ABC',
            startDate: futureDate.toISOString().split('T')[0],
            targets: [{ actualAccountId: VALID_UUID, reconcile: true, accounts: 'all' }]
          }
        }
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const loader = new ConfigLoader('/test/config.json');
      expect(() => loader.load()).toThrow('cannot be in the future');
    });

    it('warns on startDate more than 1 year ago', () => {
      const oldDate = new Date();
      oldDate.setFullYear(oldDate.getFullYear() - 2);

      const config = makeValidConfig({
        banks: {
          discount: {
            id: '123', password: 'pass', num: 'ABC',
            startDate: oldDate.toISOString().split('T')[0],
            targets: [{ actualAccountId: VALID_UUID, reconcile: true, accounts: 'all' }]
          }
        }
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const loader = new ConfigLoader('/test/config.json');
      loader.load(); // Should not throw

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('more than 1 year ago')
      );
    });

    it('throws on missing targets', () => {
      const config = makeValidConfig({
        banks: {
          discount: {
            id: '123', password: 'pass', num: 'ABC'
            // no targets
          }
        }
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const loader = new ConfigLoader('/test/config.json');
      expect(() => loader.load()).toThrow('No targets configured');
    });

    it('throws on empty targets array', () => {
      const config = makeValidConfig({
        banks: {
          discount: {
            id: '123', password: 'pass', num: 'ABC',
            targets: []
          }
        }
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const loader = new ConfigLoader('/test/config.json');
      expect(() => loader.load()).toThrow('No targets configured');
    });

    it('throws on missing actualAccountId', () => {
      const config = makeValidConfig({
        banks: {
          discount: {
            id: '123', password: 'pass', num: 'ABC',
            targets: [{ actualAccountId: '', reconcile: true, accounts: 'all' }]
          }
        }
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const loader = new ConfigLoader('/test/config.json');
      expect(() => loader.load()).toThrow('Missing actualAccountId');
    });

    it('throws on invalid actualAccountId UUID', () => {
      const config = makeValidConfig({
        banks: {
          discount: {
            id: '123', password: 'pass', num: 'ABC',
            targets: [{ actualAccountId: 'not-uuid', reconcile: true, accounts: 'all' }]
          }
        }
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const loader = new ConfigLoader('/test/config.json');
      expect(() => loader.load()).toThrow('Invalid actualAccountId format');
    });

    it('throws on missing accounts field', () => {
      const config = {
        actual: {
          init: { dataDir: './data', password: 'test', serverURL: 'http://localhost:5006' },
          budget: { syncId: VALID_UUID, password: null }
        },
        banks: {
          discount: {
            id: '123', password: 'pass', num: 'ABC',
            targets: [{ actualAccountId: VALID_UUID, reconcile: true }]
          }
        }
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const loader = new ConfigLoader('/test/config.json');
      expect(() => loader.load()).toThrow('Missing accounts field');
    });

    it('throws on invalid reconcile type', () => {
      const config = {
        actual: {
          init: { dataDir: './data', password: 'test', serverURL: 'http://localhost:5006' },
          budget: { syncId: VALID_UUID, password: null }
        },
        banks: {
          discount: {
            id: '123', password: 'pass', num: 'ABC',
            targets: [{ actualAccountId: VALID_UUID, reconcile: 'yes', accounts: 'all' }]
          }
        }
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const loader = new ConfigLoader('/test/config.json');
      expect(() => loader.load()).toThrow('Invalid reconcile field');
    });

    it('accepts accounts as array', () => {
      const config = makeValidConfig({
        banks: {
          discount: {
            id: '123', password: 'pass', num: 'ABC',
            targets: [{ actualAccountId: VALID_UUID, reconcile: true, accounts: ['1234', '5678'] }]
          }
        }
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const loader = new ConfigLoader('/test/config.json');
      expect(() => loader.load()).not.toThrow();
    });
  });

  describe('bank-specific credential validation', () => {
    it('throws when discount missing id', () => {
      const config = makeValidConfig({
        banks: {
          discount: {
            password: 'pass', num: 'ABC',
            targets: [{ actualAccountId: VALID_UUID, reconcile: true, accounts: 'all' }]
          }
        }
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const loader = new ConfigLoader('/test/config.json');
      expect(() => loader.load()).toThrow('Discount bank requires');
    });

    it('throws when leumi missing username', () => {
      const config = makeValidConfig({
        banks: {
          leumi: {
            password: 'pass',
            targets: [{ actualAccountId: VALID_UUID, reconcile: true, accounts: 'all' }]
          }
        }
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const loader = new ConfigLoader('/test/config.json');
      expect(() => loader.load()).toThrow('leumi requires: username, password');
    });

    it('throws when hapoalim missing userCode', () => {
      const config = makeValidConfig({
        banks: {
          hapoalim: {
            password: 'pass',
            targets: [{ actualAccountId: VALID_UUID, reconcile: true, accounts: 'all' }]
          }
        }
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const loader = new ConfigLoader('/test/config.json');
      expect(() => loader.load()).toThrow('Hapoalim requires: userCode, password');
    });

    it('throws when yahav missing nationalID', () => {
      const config = makeValidConfig({
        banks: {
          yahav: {
            password: 'pass',
            targets: [{ actualAccountId: VALID_UUID, reconcile: true, accounts: 'all' }]
          }
        }
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const loader = new ConfigLoader('/test/config.json');
      expect(() => loader.load()).toThrow('Yahav requires: nationalID, password');
    });

    it('throws when oneZero missing email', () => {
      const config = makeValidConfig({
        banks: {
          oneZero: {
            password: 'pass', phoneNumber: '0501234567',
            targets: [{ actualAccountId: VALID_UUID, reconcile: true, accounts: 'all' }]
          }
        }
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const loader = new ConfigLoader('/test/config.json');
      expect(() => loader.load()).toThrow('OneZero requires: email, password, phoneNumber');
    });

    it('validates email format', () => {
      const config = makeValidConfig({
        banks: {
          oneZero: {
            email: 'not-an-email', password: 'pass', phoneNumber: '0501234567890',
            targets: [{ actualAccountId: VALID_UUID, reconcile: true, accounts: 'all' }]
          }
        }
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const loader = new ConfigLoader('/test/config.json');
      expect(() => loader.load()).toThrow('Invalid email format');
    });

    it('validates phone number format', () => {
      const config = makeValidConfig({
        banks: {
          oneZero: {
            email: 'user@example.com', password: 'pass', phoneNumber: '123',
            targets: [{ actualAccountId: VALID_UUID, reconcile: true, accounts: 'all' }]
          }
        }
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const loader = new ConfigLoader('/test/config.json');
      expect(() => loader.load()).toThrow('Invalid phone number format');
    });

    it('validates card6Digits format', () => {
      const config = makeValidConfig({
        banks: {
          isracard: {
            id: '123456789', card6Digits: '12345', password: 'pass',
            targets: [{ actualAccountId: VALID_UUID, reconcile: true, accounts: 'all' }]
          }
        }
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const loader = new ConfigLoader('/test/config.json');
      expect(() => loader.load()).toThrow('Invalid card6Digits format');
    });

    it('accepts valid card6Digits', () => {
      const config = makeValidConfig({
        banks: {
          isracard: {
            id: '123456789', card6Digits: '123456', password: 'pass',
            targets: [{ actualAccountId: VALID_UUID, reconcile: true, accounts: 'all' }]
          }
        }
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const loader = new ConfigLoader('/test/config.json');
      expect(() => loader.load()).not.toThrow();
    });
  });

  describe('environment variable loading - account splitting', () => {
    afterEach(() => {
      delete process.env.ACTUAL_PASSWORD;
      delete process.env.ACTUAL_BUDGET_SYNC_ID;
      delete process.env.DISCOUNT_ID;
      delete process.env.DISCOUNT_PASSWORD;
      delete process.env.DISCOUNT_NUM;
      delete process.env.DISCOUNT_ACCOUNT_ID;
      delete process.env.DISCOUNT_ACCOUNTS;
      delete process.env.LEUMI_USERNAME;
      delete process.env.LEUMI_PASSWORD;
      delete process.env.LEUMI_ACCOUNT_ID;
      delete process.env.LEUMI_ACCOUNTS;
      delete process.env.HAPOALIM_USER_CODE;
      delete process.env.HAPOALIM_PASSWORD;
      delete process.env.HAPOALIM_ACCOUNT_ID;
      delete process.env.HAPOALIM_ACCOUNTS;
    });

    it('splits comma-separated LEUMI_ACCOUNTS into array', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      process.env.ACTUAL_PASSWORD = 'test';
      process.env.ACTUAL_BUDGET_SYNC_ID = VALID_UUID;
      process.env.LEUMI_USERNAME = 'user';
      process.env.LEUMI_PASSWORD = 'pass';
      process.env.LEUMI_ACCOUNT_ID = VALID_UUID;
      process.env.LEUMI_ACCOUNTS = '1234,5678';

      const loader = new ConfigLoader('/nonexistent');
      const config = loader.load();

      expect(config.banks.leumi?.targets?.[0].accounts).toEqual(['1234', '5678']);
    });

    it('splits comma-separated HAPOALIM_ACCOUNTS into array', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      process.env.ACTUAL_PASSWORD = 'test';
      process.env.ACTUAL_BUDGET_SYNC_ID = VALID_UUID;
      process.env.HAPOALIM_USER_CODE = 'code';
      process.env.HAPOALIM_PASSWORD = 'pass';
      process.env.HAPOALIM_ACCOUNT_ID = VALID_UUID;
      process.env.HAPOALIM_ACCOUNTS = '111,222,333';

      const loader = new ConfigLoader('/nonexistent');
      const config = loader.load();

      expect(config.banks.hapoalim?.targets?.[0].accounts).toEqual(['111', '222', '333']);
    });

    it('splits comma-separated DISCOUNT_ACCOUNTS into array', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      process.env.ACTUAL_PASSWORD = 'test';
      process.env.ACTUAL_BUDGET_SYNC_ID = VALID_UUID;
      process.env.DISCOUNT_ID = '123';
      process.env.DISCOUNT_PASSWORD = 'pass';
      process.env.DISCOUNT_NUM = 'ABC';
      process.env.DISCOUNT_ACCOUNT_ID = VALID_UUID;
      process.env.DISCOUNT_ACCOUNTS = '9999,8888';

      const loader = new ConfigLoader('/nonexistent');
      const config = loader.load();

      expect(config.banks.discount?.targets?.[0].accounts).toEqual(['9999', '8888']);
    });

    it('uses "all" as default for LEUMI_ACCOUNTS', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      process.env.ACTUAL_PASSWORD = 'test';
      process.env.ACTUAL_BUDGET_SYNC_ID = VALID_UUID;
      process.env.LEUMI_USERNAME = 'user';
      process.env.LEUMI_PASSWORD = 'pass';
      process.env.LEUMI_ACCOUNT_ID = VALID_UUID;

      const loader = new ConfigLoader('/nonexistent');
      const config = loader.load();

      expect(config.banks.leumi?.targets?.[0].accounts).toBe('all');
    });
  });

  describe('validation - empty accounts array', () => {
    it('throws on empty array accounts', () => {
      const config = makeValidConfig({
        banks: {
          discount: {
            id: '123', password: 'pass', num: 'ABC',
            targets: [{ actualAccountId: VALID_UUID, reconcile: true, accounts: [] }]
          }
        }
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));

      const loader = new ConfigLoader('/test/config.json');
      expect(() => loader.load()).toThrow('Invalid accounts field');
    });
  });
});
