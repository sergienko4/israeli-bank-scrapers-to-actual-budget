import { describe, it, expect } from 'vitest';
import {
  validateActualConfig,
  validateServerUrl,
  validateNotifications,
  validateSpendingWatch,
  validateProxy,
  isValidUUID,
  validateBank,
} from '../../src/Config/ConfigLoaderValidator.js';
import { fakeUuid, fakeImporterConfig, fakeBankConfig, fakeBankTarget } from '../helpers/factories.js';

const VALID_UUID = fakeUuid();

// ─── isValidUUID ─────────────────────────────────────────────────────────────
describe('isValidUUID', () => {
  it('returns true for a valid UUID v4', () => {
    expect(isValidUUID('12345678-1234-1234-1234-123456789abc')).toBe(true);
  });
  it('returns false for an empty string', () => {
    expect(isValidUUID('')).toBe(false);
  });
  it('returns false for a plain string', () => {
    expect(isValidUUID('not-a-uuid')).toBe(false);
  });
  it('returns false for UUID with wrong segment lengths', () => {
    expect(isValidUUID('1234-1234-1234-1234-1234')).toBe(false);
  });
});

// ─── validateActualConfig ─────────────────────────────────────────────────────
describe('validateActualConfig', () => {
  it('throws when password is missing', () => {
    const config = fakeImporterConfig({ actual: { init: { dataDir: './data', password: '', serverURL: 'http://x' }, budget: { syncId: VALID_UUID, password: null } } });
    expect(() => validateActualConfig(config)).toThrow('ACTUAL_PASSWORD is required');
  });

  it('throws when syncId is missing', () => {
    const config = fakeImporterConfig({ actual: { init: { dataDir: './data', password: 'p', serverURL: 'http://x' }, budget: { syncId: '', password: null } } });
    expect(() => validateActualConfig(config)).toThrow('ACTUAL_BUDGET_SYNC_ID is required');
  });

  it('throws when syncId is not a UUID', () => {
    const config = fakeImporterConfig({ actual: { init: { dataDir: './data', password: 'p', serverURL: 'http://x' }, budget: { syncId: 'not-uuid', password: null } } });
    expect(() => validateActualConfig(config)).toThrow('Invalid ACTUAL_BUDGET_SYNC_ID format');
  });

  it('does not throw for valid config', () => {
    const config = fakeImporterConfig({ actual: { init: { dataDir: './data', password: 'p', serverURL: 'http://x' }, budget: { syncId: VALID_UUID, password: null } } });
    expect(() => validateActualConfig(config)).not.toThrow();
  });
});

// ─── validateServerUrl ────────────────────────────────────────────────────────
describe('validateServerUrl', () => {
  it('throws for non-http URL', () => {
    expect(() => validateServerUrl('ftp://host')).toThrow('Invalid serverURL format');
  });
  it('does not throw for http URL', () => {
    expect(() => validateServerUrl('http://localhost:5006')).not.toThrow();
  });
  it('does not throw for https URL', () => {
    expect(() => validateServerUrl('https://actual.example.com')).not.toThrow();
  });
});

// ─── validateNotifications ────────────────────────────────────────────────────
describe('validateNotifications', () => {
  it('throws for invalid Telegram bot token format', () => {
    expect(() => validateNotifications({
      enabled: true,
      telegram: { botToken: 'bad-token', chatId: '-123' },
    })).toThrow('Invalid Telegram botToken format');
  });

  it('throws when Telegram botToken is missing', () => {
    expect(() => validateNotifications({
      enabled: true,
      telegram: { botToken: '', chatId: '-123' },
    })).toThrow('botToken is required');
  });

  it('throws when Telegram chatId is missing', () => {
    expect(() => validateNotifications({
      enabled: true,
      telegram: { botToken: '123456:ABCdef', chatId: '' },
    })).toThrow('chatId is required');
  });

  it('throws for invalid webhook URL', () => {
    expect(() => validateNotifications({
      enabled: true,
      webhook: { url: 'ftp://bad', format: 'slack' },
    })).toThrow('Invalid webhook url format');
  });

  it('does not throw for valid telegram config', () => {
    expect(() => validateNotifications({
      enabled: true,
      telegram: { botToken: '123456789:ABCdefGHI', chatId: '-100123' },
    })).not.toThrow();
  });

  it('throws for invalid messageFormat enum', () => {
    expect(() => validateNotifications({
      enabled: true,
      telegram: { botToken: '123456789:ABCdef', chatId: '-100', messageFormat: 'invalid' as never },
    })).toThrow('Invalid messageFormat');
  });
});

// ─── validateSpendingWatch ────────────────────────────────────────────────────
describe('validateSpendingWatch', () => {
  it('throws when alertFromAmount is zero', () => {
    expect(() => validateSpendingWatch([{ alertFromAmount: 0, numOfDayToCount: 7 }]))
      .toThrow('alertFromAmount is required and must be positive');
  });

  it('throws when numOfDayToCount is out of range', () => {
    expect(() => validateSpendingWatch([{ alertFromAmount: 100, numOfDayToCount: 400 }]))
      .toThrow('numOfDayToCount must be an integer between 1 and 365');
  });

  it('throws when numOfDayToCount is 0', () => {
    expect(() => validateSpendingWatch([{ alertFromAmount: 100, numOfDayToCount: 0 }]))
      .toThrow('numOfDayToCount');
  });

  it('throws when watchPayees is not an array', () => {
    expect(() => validateSpendingWatch([{
      alertFromAmount: 100, numOfDayToCount: 7, watchPayees: 'not-array' as never,
    }])).toThrow('watchPayees must be an array');
  });

  it('does not throw for valid rule', () => {
    expect(() => validateSpendingWatch([{ alertFromAmount: 100, numOfDayToCount: 7 }])).not.toThrow();
  });

  it('does not throw for rule with watchPayees array', () => {
    expect(() => validateSpendingWatch([{
      alertFromAmount: 100, numOfDayToCount: 7, watchPayees: ['שופרסל'],
    }])).not.toThrow();
  });
});

// ─── validateProxy ───────────────────────────────────────────────────────────
describe('validateProxy', () => {
  it('throws when server is empty', () => {
    expect(() => validateProxy({ server: '' })).toThrow('proxy.server is required');
  });

  it('throws for unsupported protocol', () => {
    expect(() => validateProxy({ server: 'ftp://proxy:8080' })).toThrow('Invalid proxy.server format');
  });

  it('does not throw for socks5 proxy', () => {
    expect(() => validateProxy({ server: 'socks5://proxy:1080' })).not.toThrow();
  });

  it('does not throw for http proxy', () => {
    expect(() => validateProxy({ server: 'http://proxy:8080' })).not.toThrow();
  });
});

// ─── validateBank ─────────────────────────────────────────────────────────────
describe('validateBank', () => {
  it('throws when both startDate and daysBack are set', () => {
    const config = fakeBankConfig({ startDate: '2026-01-01', daysBack: 7 });
    expect(() => validateBank('discount', config)).toThrow('cannot use both');
  });

  it('throws when daysBack is out of range', () => {
    const config = fakeBankConfig({ daysBack: 50, startDate: undefined });
    expect(() => validateBank('discount', config)).toThrow('"daysBack" must be an integer between 1 and 30');
  });

  it('throws when no targets are configured', () => {
    const config = fakeBankConfig({ daysBack: 7, startDate: undefined, targets: [] });
    expect(() => validateBank('discount', config)).toThrow('No targets configured');
  });

  it('throws when actualAccountId is not a UUID', () => {
    const target = fakeBankTarget({ actualAccountId: 'bad-id', accounts: 'all' });
    const config = fakeBankConfig({ daysBack: 7, startDate: undefined, targets: [target] });
    expect(() => validateBank('discount', config)).toThrow('Invalid actualAccountId format');
  });

  it('throws when required Discount credentials are missing', () => {
    const config = fakeBankConfig({
      id: '', num: '', daysBack: 7, startDate: undefined,
      targets: [fakeBankTarget({ actualAccountId: VALID_UUID, accounts: 'all' })],
    });
    expect(() => validateBank('discount', config)).toThrow('Discount bank requires');
  });

  it('throws when startDate is in the future', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const dateStr = future.toISOString().split('T')[0];
    const config = fakeBankConfig({ startDate: dateStr, daysBack: undefined });
    expect(() => validateBank('discount', config)).toThrow('cannot be in the future');
  });

  it('throws when startDate is more than 1 year ago', () => {
    const config = fakeBankConfig({ startDate: '2000-01-01', daysBack: undefined });
    expect(() => validateBank('discount', config)).toThrow('cannot be more than 1 year ago');
  });

  it('does not throw for a valid bank config', () => {
    const config = fakeBankConfig({
      id: '123', password: 'p', num: 'ABC',
      daysBack: 7, startDate: undefined,
      targets: [fakeBankTarget({ actualAccountId: VALID_UUID, accounts: 'all' })],
    });
    expect(() => validateBank('discount', config)).not.toThrow();
  });

  it('does not throw for an unknown bank (no credential spec)', () => {
    const config = fakeBankConfig({
      daysBack: 7, startDate: undefined,
      targets: [fakeBankTarget({ actualAccountId: VALID_UUID, accounts: 'all' })],
    });
    expect(() => validateBank('unknownbank', config)).not.toThrow();
  });

  it('throws when accounts field is empty array', () => {
    const target = fakeBankTarget({ actualAccountId: VALID_UUID, accounts: [] as never });
    const config = fakeBankConfig({ daysBack: 7, startDate: undefined, targets: [target] });
    expect(() => validateBank('discount', config)).toThrow('Invalid accounts field');
  });

  it('validates reconcile field must be boolean', () => {
    const target = fakeBankTarget({ actualAccountId: VALID_UUID, accounts: 'all', reconcile: 'yes' as never });
    const config = fakeBankConfig({ daysBack: 7, startDate: undefined, targets: [target] });
    expect(() => validateBank('discount', config)).toThrow('Invalid reconcile field');
  });

  it('throws for invalid email format', () => {
    const config = fakeBankConfig({
      email: 'not-an-email',
      daysBack: 7, startDate: undefined,
      targets: [fakeBankTarget({ actualAccountId: VALID_UUID, accounts: 'all' })],
    });
    expect(() => validateBank('discount', config)).toThrow('Invalid email format');
  });
});
