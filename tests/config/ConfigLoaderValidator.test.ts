import { describe, it, expect } from 'vitest';
import {
  validateActualConfig,
  validateServerUrl,
  validateNotifications,
  validateSpendingWatch,
  validateProxy,
  isValidUUID,
  validateBank,
  CREDENTIAL_SPECS,
} from '../../src/Config/ConfigLoaderValidator.js';
import { isFail } from '../../src/Types/ProcedureHelpers.js';
import {
  fakeUuid,
  fakeImporterConfig,
  fakeBankConfig,
  fakeBankTarget,
  fakeValidBankConfigFor,
  fakeBankConfigMissingField,
  BANK_SPEC_CASES,
  BANK_MISSING_FIELD_CASES,
} from '../helpers/factories.js';
import { TEST_CREDENTIAL_SHORT } from '../helpers/testCredentials.js';

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
    const result = validateActualConfig(config);
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('ACTUAL_PASSWORD is required');
  });

  it('throws when syncId is missing', () => {
    const config = fakeImporterConfig({ actual: { init: { dataDir: './data', password: TEST_CREDENTIAL_SHORT, serverURL: 'http://x' }, budget: { syncId: '', password: null } } });
    const result = validateActualConfig(config);
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('ACTUAL_BUDGET_SYNC_ID is required');
  });

  it('throws when syncId is not a UUID', () => {
    const config = fakeImporterConfig({ actual: { init: { dataDir: './data', password: TEST_CREDENTIAL_SHORT, serverURL: 'http://x' }, budget: { syncId: 'not-uuid', password: null } } });
    const result = validateActualConfig(config);
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('Invalid ACTUAL_BUDGET_SYNC_ID format');
  });

  it('does not throw for valid config', () => {
    const config = fakeImporterConfig({ actual: { init: { dataDir: './data', password: TEST_CREDENTIAL_SHORT, serverURL: 'http://x' }, budget: { syncId: VALID_UUID, password: null } } });
    const result = validateActualConfig(config);
    expect(result.success).toBe(true);
  });
});

// ─── validateServerUrl ────────────────────────────────────────────────────────
describe('validateServerUrl', () => {
  it('throws for non-http URL', () => {
    const result = validateServerUrl('ftp://host');
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('Invalid serverURL format');
  });
  it('does not throw for http URL', () => {
    const result = validateServerUrl('http://localhost:5006');
    expect(result.success).toBe(true);
  });
  it('does not throw for https URL', () => {
    const result = validateServerUrl('https://actual.example.com');
    expect(result.success).toBe(true);
  });
});

// ─── validateNotifications ────────────────────────────────────────────────────
describe('validateNotifications', () => {
  it('throws for invalid Telegram bot token format', () => {
    const result = validateNotifications({
      enabled: true,
      telegram: { botToken: 'bad-token', chatId: '-123' },
    });
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('Invalid botToken format');
  });

  it('throws when Telegram botToken is missing', () => {
    const result = validateNotifications({
      enabled: true,
      telegram: { botToken: '', chatId: '-123' },
    });
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('botToken is required');
  });

  it('throws when Telegram chatId is missing', () => {
    const result = validateNotifications({
      enabled: true,
      telegram: { botToken: '123456:ABCdef', chatId: '' },
    });
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('chatId is required');
  });

  it('throws for invalid webhook URL', () => {
    const result = validateNotifications({
      enabled: true,
      webhook: { url: 'ftp://bad', format: 'slack' },
    });
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('Invalid webhook url format');
  });

  it('does not throw for valid telegram config', () => {
    const result = validateNotifications({
      enabled: true,
      telegram: { botToken: '123456789:ABCdefGHI', chatId: '-100123' },
    });
    expect(result.success).toBe(true);
  });

  it('throws for invalid messageFormat enum', () => {
    const result = validateNotifications({
      enabled: true,
      telegram: { botToken: '123456789:ABCdef', chatId: '-100', messageFormat: 'invalid' as never },
    });
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('Invalid messageFormat');
  });

  it('throws when enabled with no channel configured', () => {
    const result = validateNotifications({ enabled: true });
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('at least one notification channel');
  });
});

// ─── validateSpendingWatch ────────────────────────────────────────────────────
describe('validateSpendingWatch', () => {
  it('throws when alertFromAmount is zero', () => {
    const result = validateSpendingWatch([{ alertFromAmount: 0, numOfDayToCount: 7 }]);
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('alertFromAmount is required and must be positive');
  });

  it('throws when numOfDayToCount is out of range', () => {
    const result = validateSpendingWatch([{ alertFromAmount: 100, numOfDayToCount: 400 }]);
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('numOfDayToCount must be an integer between 1 and 365');
  });

  it('throws when numOfDayToCount is 0', () => {
    const result = validateSpendingWatch([{ alertFromAmount: 100, numOfDayToCount: 0 }]);
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('numOfDayToCount');
  });

  it('throws when watchPayees is not an array', () => {
    const result = validateSpendingWatch([{
      alertFromAmount: 100, numOfDayToCount: 7, watchPayees: 'not-array' as never,
    }]);
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('watchPayees must be an array');
  });

  it('does not throw for valid rule', () => {
    const result = validateSpendingWatch([{ alertFromAmount: 100, numOfDayToCount: 7 }]);
    expect(result.success).toBe(true);
  });

  it('does not throw for rule with watchPayees array', () => {
    const result = validateSpendingWatch([{
      alertFromAmount: 100, numOfDayToCount: 7, watchPayees: ['שופרסל'],
    }]);
    expect(result.success).toBe(true);
  });
});

// ─── validateProxy ───────────────────────────────────────────────────────────
describe('validateProxy', () => {
  it('throws when server is empty', () => {
    const result = validateProxy({ server: '' });
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('proxy.server is required');
  });

  it('throws for unsupported protocol', () => {
    const result = validateProxy({ server: 'ftp://proxy:8080' });
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('Invalid proxy.server format');
  });

  it('does not throw for socks5 proxy', () => {
    const result = validateProxy({ server: 'socks5://proxy:1080' });
    expect(result.success).toBe(true);
  });

  it('does not throw for http proxy', () => {
    const result = validateProxy({ server: 'http://proxy:8080' });
    expect(result.success).toBe(true);
  });
});

// ─── validateBank ─────────────────────────────────────────────────────────────
describe('validateBank', () => {
  it('throws when both startDate and daysBack are set', () => {
    const config = fakeBankConfig({ startDate: '2026-01-01', daysBack: 7 });
    const result = validateBank('discount', config);
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('cannot use both');
  });

  it('throws when daysBack is out of range', () => {
    const config = fakeBankConfig({ daysBack: 50, startDate: undefined });
    const result = validateBank('discount', config);
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('"daysBack" must be an integer between 1 and 30');
  });

  it('throws when no targets are configured', () => {
    const config = fakeBankConfig({ daysBack: 7, startDate: undefined, targets: [] });
    const result = validateBank('discount', config);
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('No targets configured');
  });

  it('throws when actualAccountId is not a UUID', () => {
    const target = fakeBankTarget({ actualAccountId: 'bad-id', accounts: 'all' });
    const config = fakeBankConfig({ daysBack: 7, startDate: undefined, targets: [target] });
    const result = validateBank('discount', config);
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('Invalid actualAccountId format');
  });

  it('throws when startDate is in the future', () => {
    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const dateStr = future.toISOString().split('T')[0];
    const config = fakeBankConfig({ startDate: dateStr, daysBack: undefined });
    const result = validateBank('discount', config);
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('cannot be in the future');
  });

  it('throws when startDate is more than 1 year ago', () => {
    const config = fakeBankConfig({ startDate: '2000-01-01', daysBack: undefined });
    const result = validateBank('discount', config);
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('startDate too old');
  });

  it('does not throw for an unknown bank (no credential spec)', () => {
    const config = fakeBankConfig({
      daysBack: 7, startDate: undefined,
      targets: [fakeBankTarget({ actualAccountId: VALID_UUID, accounts: 'all' })],
    });
    const result = validateBank('unknownbank', config);
    expect(result.success).toBe(true);
  });

  it('throws when accounts field is empty array', () => {
    const target = fakeBankTarget({ actualAccountId: VALID_UUID, accounts: [] as never });
    const config = fakeBankConfig({ daysBack: 7, startDate: undefined, targets: [target] });
    const result = validateBank('discount', config);
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('Invalid accounts for');
  });

  it('validates reconcile field must be boolean', () => {
    const target = fakeBankTarget({ actualAccountId: VALID_UUID, accounts: 'all', reconcile: 'yes' as never });
    const config = fakeBankConfig({ daysBack: 7, startDate: undefined, targets: [target] });
    const result = validateBank('discount', config);
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('Invalid reconcile for');
  });

  it('throws for invalid email format', () => {
    const config = fakeBankConfig({
      email: 'not-an-email',
      daysBack: 7, startDate: undefined,
      targets: [fakeBankTarget({ actualAccountId: VALID_UUID, accounts: 'all' })],
    });
    const result = validateBank('discount', config);
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('Invalid email format');
  });

  it('rejects a non-array targets value instead of silently accepting it', () => {
    const config = fakeBankConfig({
      daysBack: 7, startDate: undefined,
      targets: {} as never,
    });
    const result = validateBank('discount', config);
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('No targets configured');
  });

  it('rejects a null entry in targets without throwing', () => {
    const config = fakeBankConfig({
      daysBack: 7, startDate: undefined,
      targets: [null] as never,
    });
    const result = validateBank('discount', config);
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('Must be an object');
  });

  it('rejects a non-string element in an accounts array', () => {
    const config = fakeBankConfig({
      daysBack: 7, startDate: undefined,
      targets: [fakeBankTarget({ actualAccountId: VALID_UUID, accounts: [null] as never })],
    });
    const result = validateBank('discount', config);
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('Invalid accounts for');
  });

  it('rejects a separator-only phone number', () => {
    const config = fakeBankConfig({
      phoneNumber: '---',
      daysBack: 7, startDate: undefined,
      targets: [fakeBankTarget({ actualAccountId: VALID_UUID, accounts: 'all' })],
    });
    const result = validateBank('discount', config);
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('Invalid phone number format');
  });

  it('rejects a non-string phone number without throwing', () => {
    const config = fakeBankConfig({
      phoneNumber: 12345 as never,
      daysBack: 7, startDate: undefined,
      targets: [fakeBankTarget({ actualAccountId: VALID_UUID, accounts: 'all' })],
    });
    const result = validateBank('discount', config);
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('Invalid phone number format');
  });

  it('rejects a numeric card6Digits value', () => {
    const config = fakeBankConfig({
      card6Digits: 123456 as never,
      daysBack: 7, startDate: undefined,
      targets: [fakeBankTarget({ actualAccountId: VALID_UUID, accounts: 'all' })],
    });
    const result = validateBank('discount', config);
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('Invalid card6Digits format');
  });

  it('rejects a non-string actualAccountId instead of coercing it through the UUID check', () => {
    const config = fakeBankConfig({
      daysBack: 7, startDate: undefined,
      targets: [fakeBankTarget({ actualAccountId: [VALID_UUID] as never, accounts: 'all' })],
    });
    const result = validateBank('discount', config);
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('actualAccountId');
  });

  it('rejects a non-string email instead of coercing it through the format check', () => {
    const config = fakeBankConfig({
      email: ['user@example.com'] as never,
      daysBack: 7, startDate: undefined,
      targets: [fakeBankTarget({ actualAccountId: VALID_UUID, accounts: 'all' })],
    });
    const result = validateBank('discount', config);
    expect(result.success).toBe(false);
    expect(isFail(result) && result.message).toContain('Invalid email format');
  });

  // Spec-driven cross-bank credential coverage. Replaces hand-rolled per-bank
  // cases — adding a bank to CREDENTIAL_SPECS automatically extends coverage.
  it.each(BANK_SPEC_CASES)(
    'accepts a valid $bankId config built from CREDENTIAL_SPECS',
    ({ bankId }) => {
      const config = fakeValidBankConfigFor(bankId, {
        targets: [fakeBankTarget({ actualAccountId: VALID_UUID, accounts: 'all' })],
      });
      const result = validateBank(bankId, config);
      expect(result.success).toBe(true);
    },
  );

  it.each(BANK_MISSING_FIELD_CASES)(
    'rejects $bankId when required field $field is missing',
    ({ bankId, field }) => {
      const config = {
        ...fakeBankConfigMissingField(bankId, field),
        targets: [fakeBankTarget({ actualAccountId: VALID_UUID, accounts: 'all' })],
      };
      const result = validateBank(bankId, config);
      expect(result.success).toBe(false);
      const spec = CREDENTIAL_SPECS[bankId];
      expect(isFail(result) && result.message).toContain(`${spec.displayName} requires: ${spec.label}`);
    },
  );
});
