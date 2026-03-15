import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigValidator, ValidationResult, runValidateMode } from '../../src/Config/ConfigValidator.js';
import { ImporterConfig } from '../../src/Types/Index.js';
import * as fs from 'fs';
import { fakeUuid } from '../helpers/factories.js';
import { TEST_CREDENTIAL, TEST_CREDENTIAL_SHORT } from '../helpers/testCredentials.js';

vi.mock('fs');

// Used only in runValidateMode inline objects (where exact UUID is needed by readFileSync mock)
const VALID_UUID = '12345678-1234-1234-1234-123456789abc';

/**
 * Creates a valid test config with optional overrides.
 * @param overrides - Fields to merge over the default config.
 * @returns A complete ImporterConfig for testing.
 */
function makeConfig(overrides: Record<string, unknown> = {}): ImporterConfig {
  return {
    actual: {
      init: { dataDir: './data', password: TEST_CREDENTIAL, serverURL: 'http://localhost:5006' },
      budget: { syncId: fakeUuid(), password: null },
    },
    banks: {
      discount: {
        id: '123', password: TEST_CREDENTIAL_SHORT, num: 'ABC', daysBack: 7,
        targets: [{ actualAccountId: fakeUuid(), reconcile: true, accounts: 'all' }],
      },
    },
    ...overrides,
  } as ImporterConfig;
}

/**
 * Filters validation results by status.
 * @param results - The full results array.
 * @param status - The status to filter by.
 * @returns Filtered results matching the given status.
 */
function byStatus(results: ValidationResult[], status: string): ValidationResult[] {
  return results.filter(r => r.status === status);
}

/** @param results - Results to filter. @returns Only passing results. */
function pass(results: ValidationResult[]): ValidationResult[] {
  return byStatus(results, 'pass');
}
/** @param results - Results to filter. @returns Only failing results. */
function fail(results: ValidationResult[]): ValidationResult[] {
  return byStatus(results, 'fail');
}
/** @param results - Results to filter. @returns Only warning results. */
function warn(results: ValidationResult[]): ValidationResult[] {
  return byStatus(results, 'warn');
}

/**
 * Asserts that a check with the given name exists with the expected status.
 * @param results - The validation results to search.
 * @param check - The check name to find.
 * @param status - Expected status: 'pass', 'fail', or 'warn'.
 */
function expectCheck(results: ValidationResult[], check: string, status: 'pass' | 'fail' | 'warn'): void {
  const matching = results.filter(r => r.check === check);
  expect(matching.length).toBeGreaterThan(0);
  expect(matching.every(r => r.status === status)).toBe(true);
}

/**
 * Returns mock responses for the budget login and list-user-files endpoints.
 * @param syncId - The sync ID to include in the server file list.
 * @returns Two mock response objects: login then list-user-files.
 */
function budgetFoundMocks(syncId: string): object[] {
  return [
    { ok: true, status: 200, json: async () => ({ data: { token: 'tok' } }) },
    { ok: true, status: 200, json: async () => ({ data: [{ groupId: syncId }] }) },
  ];
}

/**
 * Returns mock responses for budget check where the budget is not found.
 * @returns Two mock response objects: login then empty file list.
 */
function budgetNotFoundMocks(): object[] {
  return [
    { ok: true, status: 200, json: async () => ({ data: { token: 'tok' } }) },
    { ok: true, status: 200, json: async () => ({ data: [] }) },
  ];
}

/**
 * Sets up fetch mocks for online validation: server ping + budget login/list.
 * @param cfg - The config whose syncId to use for budget found response.
 * @param extra - Additional mock responses to chain after budget mocks.
 * @returns The vi.fn() fetch mock for further assertions.
 */
function setupOnlineMocks(cfg: ImporterConfig, extra: object[] = []): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, status: 200 })
    .mockResolvedValueOnce(budgetFoundMocks(cfg.actual.budget.syncId)[0])
    .mockResolvedValueOnce(budgetFoundMocks(cfg.actual.budget.syncId)[1]);
  for (const mock of extra) {
    fetchMock.mockResolvedValueOnce(mock);
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ConfigValidator', () => {
  let validator: ConfigValidator;

  beforeEach(() => {
    validator = new ConfigValidator();
  });

  // ─── Actual offline ───

  describe('actual.password', () => {
    it('passes when password set', () => {
      const results = validator.validateOffline(makeConfig());
      expectCheck(results, 'actual.password', 'pass');
    });

    it('fails when password empty', () => {
      const cfg = makeConfig();
      cfg.actual.init.password = '';
      const results = validator.validateOffline(cfg);
      expectCheck(results, 'actual.password', 'fail');
    });
  });

  describe('actual.syncId', () => {
    it('passes on valid UUID', () => {
      const results = validator.validateOffline(makeConfig());
      expectCheck(results, 'actual.syncId', 'pass');
    });

    it('fails on invalid UUID', () => {
      const cfg = makeConfig();
      cfg.actual.budget.syncId = 'not-a-uuid';
      const results = validator.validateOffline(cfg);
      expectCheck(results, 'actual.syncId', 'fail');
    });

    it('fails on empty syncId', () => {
      const cfg = makeConfig();
      cfg.actual.budget.syncId = '';
      const results = validator.validateOffline(cfg);
      expectCheck(results, 'actual.syncId', 'fail');
    });
  });

  describe('actual.serverURL', () => {
    it('passes on http URL', () => {
      const results = validator.validateOffline(makeConfig());
      expectCheck(results, 'actual.serverURL', 'pass');
    });

    it('passes on https URL', () => {
      const cfg = makeConfig();
      cfg.actual.init.serverURL = 'https://actual.example.com';
      const results = validator.validateOffline(cfg);
      expectCheck(results, 'actual.serverURL', 'pass');
    });

    it('fails on non-http URL', () => {
      const cfg = makeConfig();
      cfg.actual.init.serverURL = 'ftp://bad';
      const results = validator.validateOffline(cfg);
      expectCheck(results, 'actual.serverURL', 'fail');
    });

    it('fails and does not crash when serverURL is undefined (shallow-merge bug regression)', () => {
      // Simulates loadFullConfig() shallow spread stripping actual.init.serverURL
      // when credentials.json has an 'actual' section
      const cfg = makeConfig();
      (cfg.actual.init as Record<string, unknown>).serverURL = undefined;
      expect(() => validator.validateOffline(cfg)).not.toThrow();
      const results = validator.validateOffline(cfg);
      expectCheck(results, 'actual.serverURL', 'fail');
    });
  });

  // ─── Bank names ───

  describe('bank name validation', () => {
    it('passes for known bank', () => {
      const results = validator.validateOffline(makeConfig());
      expectCheck(results, 'bank.discount', 'pass');
    });

    it('passes for camelCase alias (oneZero)', () => {
      const cfg = makeConfig({
        banks: {
          oneZero: {
            email: 'a@b.com', password: TEST_CREDENTIAL_SHORT, phoneNumber: '+1234567890',
            targets: [{ actualAccountId: fakeUuid(), reconcile: true, accounts: 'all' }],
          },
        },
      });
      const results = validator.validateOffline(cfg);
      expect(fail(results).some(r => r.check === 'bank.oneZero')).toBe(false);
    });

    it('fails for unknown bank name', () => {
      const cfg = makeConfig({
        banks: {
          unknownxyz: {
            password: TEST_CREDENTIAL_SHORT,
            targets: [{ actualAccountId: fakeUuid(), reconcile: true, accounts: 'all' }],
          },
        },
      });
      const results = validator.validateOffline(cfg);
      expectCheck(results, 'bank.unknownxyz', 'fail');
    });

    it('suggests "discount" for "disount" typo', () => {
      const cfg = makeConfig({
        banks: {
          disount: {
            id: '1', password: TEST_CREDENTIAL_SHORT, num: 'A',
            targets: [{ actualAccountId: fakeUuid(), reconcile: true, accounts: 'all' }],
          },
        },
      });
      const results = validator.validateOffline(cfg);
      const failResult = fail(results).find(r => r.check === 'bank.disount');
      expect(failResult?.message).toContain('discount');
    });

    it('suggests "leumi" for "leumu" typo', () => {
      const cfg = makeConfig({
        banks: {
          leumu: {
            username: 'u', password: TEST_CREDENTIAL_SHORT,
            targets: [{ actualAccountId: fakeUuid(), reconcile: true, accounts: 'all' }],
          },
        },
      });
      const results = validator.validateOffline(cfg);
      const failResult = fail(results).find(r => r.check === 'bank.leumu');
      expect(failResult?.message).toContain('leumi');
    });

    it('gives no suggestion for completely different name', () => {
      const cfg = makeConfig({
        banks: {
          zzznotabank: {
            password: TEST_CREDENTIAL_SHORT,
            targets: [{ actualAccountId: fakeUuid(), reconcile: true, accounts: 'all' }],
          },
        },
      });
      const results = validator.validateOffline(cfg);
      const failResult = fail(results).find(r => r.check === 'bank.zzznotabank');
      expect(failResult?.message).not.toContain('Did you mean');
    });
  });

  // ─── Bank dates ───

  describe('bank dates', () => {
    it('warns when no daysBack/startDate set', () => {
      const cfg = makeConfig({
        banks: {
          leumi: {
            username: 'u', password: TEST_CREDENTIAL_SHORT,
            targets: [{ actualAccountId: fakeUuid(), reconcile: true, accounts: 'all' }],
          },
        },
      });
      const results = validator.validateOffline(cfg);
      expectCheck(results, 'bank.leumi.dates', 'warn');
    });

    it('fails when both startDate and daysBack are set', () => {
      const cfg = makeConfig({
        banks: {
          leumi: {
            username: 'u', password: TEST_CREDENTIAL_SHORT, daysBack: 7, startDate: '2026-01-01',
            targets: [{ actualAccountId: fakeUuid(), reconcile: true, accounts: 'all' }],
          },
        },
      });
      const results = validator.validateOffline(cfg);
      expectCheck(results, 'bank.leumi.dates', 'fail');
    });

    it('passes when only daysBack set', () => {
      const results = validator.validateOffline(makeConfig());
      expectCheck(results, 'bank.discount.dates', 'pass');
    });
  });

  // ─── Bank targets ───

  describe('bank targets', () => {
    it('fails when no targets', () => {
      const cfg = makeConfig({
        banks: { discount: { id: '1', password: TEST_CREDENTIAL_SHORT, num: 'A', daysBack: 7 } },
      });
      const results = validator.validateOffline(cfg);
      expectCheck(results, 'bank.discount.targets', 'fail');
    });

    it('fails on invalid UUID in actualAccountId', () => {
      const cfg = makeConfig({
        banks: {
          discount: {
            id: '1', password: TEST_CREDENTIAL_SHORT, num: 'A', daysBack: 7,
            targets: [{ actualAccountId: 'bad-uuid', reconcile: true, accounts: 'all' }],
          },
        },
      });
      const results = validator.validateOffline(cfg);
      expectCheck(results, 'bank.discount.target[0]', 'fail');
    });

    it('passes on valid target', () => {
      const results = validator.validateOffline(makeConfig());
      expectCheck(results, 'bank.discount.target[0]', 'pass');
    });

    it('uses accountName as label in pass message when set', () => {
      const cfg = makeConfig({
        banks: {
          discount: {
            id: '1', password: TEST_CREDENTIAL_SHORT, num: 'A', daysBack: 7,
            targets: [{ actualAccountId: fakeUuid(), accountName: 'Main Checking', reconcile: false, accounts: 'all' }],
          },
        },
      });
      const results = validator.validateOffline(cfg);
      const msg = pass(results).find(r => r.check === 'bank.discount.target[0]')?.message ?? '';
      expect(msg).toContain('"Main Checking"');
    });

    it('falls back to last UUID segment as label when accountName is absent', () => {
      const results = validator.validateOffline(makeConfig());
      const msg = pass(results).find(r => r.check === 'bank.discount.target[0]')?.message ?? '';
      expect(msg).toMatch(/"\.\.\.[0-9a-f]+"/);
    });
  });

  // ─── Notifications offline ───

  describe('notifications offline', () => {
    it('skips when notifications disabled', () => {
      const cfg = makeConfig({ notifications: { enabled: false } });
      const results = validator.validateOffline(cfg);
      expect(results.some(r => r.check.startsWith('telegram'))).toBe(false);
    });

    it('fails on invalid Telegram botToken format', () => {
      const cfg = makeConfig({
        notifications: {
          enabled: true,
          telegram: { botToken: 'badtoken', chatId: '12345' },
        },
      });
      const results = validator.validateOffline(cfg);
      expectCheck(results, 'telegram.botToken', 'fail');
    });

    it('passes on valid Telegram botToken format', () => {
      const cfg = makeConfig({
        notifications: {
          enabled: true,
          telegram: { botToken: '123456789:ABCdef', chatId: '12345' },
        },
      });
      const results = validator.validateOffline(cfg);
      expectCheck(results, 'telegram.botToken', 'pass');
    });

    it('fails when Telegram chatId missing', () => {
      const cfg = makeConfig({
        notifications: {
          enabled: true,
          telegram: { botToken: '123456789:ABCdef', chatId: '' },
        },
      });
      const results = validator.validateOffline(cfg);
      expectCheck(results, 'telegram.chatId', 'fail');
    });

    it('fails on invalid webhook URL format', () => {
      const cfg = makeConfig({
        notifications: {
          enabled: true,
          webhook: { url: 'ftp://bad.com' },
        },
      });
      const results = validator.validateOffline(cfg);
      expectCheck(results, 'webhook.url', 'fail');
    });

    it('fails and does not crash when webhook url is undefined (missing field regression)', () => {
      const cfg = makeConfig({
        notifications: {
          enabled: true,
          webhook: { url: undefined as unknown as string },
        },
      });
      expect(() => validator.validateOffline(cfg)).not.toThrow();
      const results = validator.validateOffline(cfg);
      expectCheck(results, 'webhook.url', 'fail');
    });

    it('passes on valid webhook URL', () => {
      const cfg = makeConfig({
        notifications: {
          enabled: true,
          webhook: { url: 'https://hooks.example.com/abc' },
        },
      });
      const results = validator.validateOffline(cfg);
      expectCheck(results, 'webhook.url', 'pass');
    });
  });

  // ─── No banks ───

  it('fails when banks is empty', () => {
    const cfg = makeConfig({ banks: {} });
    const results = validator.validateOffline(cfg);
    expectCheck(results, 'banks', 'fail');
  });

  // ─── formatReport ───

  describe('formatReport', () => {
    it('shows PASS/FAIL/WARN labels', () => {
      const results: ValidationResult[] = [
        { status: 'pass', check: 'a', message: 'good' },
        { status: 'fail', check: 'b', message: 'bad' },
        { status: 'warn', check: 'c', message: 'warning' },
      ];
      const report = validator.formatReport(results);
      expect(report).toContain('[PASS] good');
      expect(report).toContain('[FAIL] bad');
      expect(report).toContain('[WARN] warning');
    });

    it('shows "All checks passed" when no issues', () => {
      const results: ValidationResult[] = [
        { status: 'pass', check: 'a', message: 'ok' },
      ];
      const report = validator.formatReport(results);
      expect(report).toContain('All checks passed');
    });

    it('shows error count in summary', () => {
      const results: ValidationResult[] = [
        { status: 'fail', check: 'a', message: 'bad1' },
        { status: 'fail', check: 'b', message: 'bad2' },
        { status: 'warn', check: 'c', message: 'w1' },
      ];
      const report = validator.formatReport(results);
      expect(report).toContain('2 errors');
      expect(report).toContain('1 warning');
    });
  });

  // ─── Online (mocked fetch) ───

  describe('validateOnline', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('passes when Actual server responds with 2xx', async () => {
      const cfg = makeConfig();
      setupOnlineMocks(cfg);
      const results = await validator.validateOnline(cfg);
      expectCheck(results, 'actual.server', 'pass');
    });

    it('fails when Actual server is unreachable', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
      const results = await validator.validateOnline(makeConfig());
      expectCheck(results, 'actual.server', 'fail');
    });

    it('skips budget check when server is unreachable', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
      const results = await validator.validateOnline(makeConfig());
      expect(results.some(r => r.check === 'actual.budget')).toBe(false);
    });

    it('checks Telegram token when notifications enabled', async () => {
      const cfg = makeConfig({
        notifications: {
          enabled: true,
          telegram: { botToken: '123456789:ABCdef', chatId: '12345' },
        },
      });
      setupOnlineMocks(cfg, [{
        ok: true, status: 200,
        json: async () => ({ ok: true, result: { username: 'TestBot' } }),
      }]);
      const results = await validator.validateOnline(cfg);
      expectCheck(results, 'telegram.token', 'pass');
      expect(pass(results).find(r => r.check === 'telegram.token')?.message)
        .toContain('@TestBot');
    });

    it('fails on invalid Telegram token', async () => {
      const cfg = makeConfig({
        notifications: {
          enabled: true,
          telegram: { botToken: '000:bad', chatId: '12345' },
        },
      });
      setupOnlineMocks(cfg, [{
        ok: true, status: 200,
        json: async () => ({ ok: false }),
      }]);
      const results = await validator.validateOnline(cfg);
      expectCheck(results, 'telegram.token', 'fail');
    });

    it('warns when webhook returns non-2xx on HEAD', async () => {
      const cfg = makeConfig({
        notifications: {
          enabled: true,
          webhook: { url: 'https://hooks.example.com/x' },
        },
      });
      setupOnlineMocks(cfg, [{ ok: false, status: 405 }]);
      const results = await validator.validateOnline(cfg);
      expectCheck(results, 'webhook.url', 'warn');
    });

    it('skips online checks when offline has failures', async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);
      const cfg = makeConfig({ banks: {} }); // will fail offline
      const results = await validator.validateAll(cfg);
      expect(mockFetch).not.toHaveBeenCalled();
      expectCheck(results, 'banks', 'fail');
    });

    it('fails when webhook URL is unreachable', async () => {
      const cfg = makeConfig({
        notifications: { enabled: true, webhook: { url: 'https://gone.example.com' } },
      });
      const fetchMock = setupOnlineMocks(cfg);
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED')); // webhook
      const results = await validator.validateOnline(cfg);
      expectCheck(results, 'webhook.url', 'fail');
    });
  });

  // ─── Budget existence check ───

  describe('checkActualBudget', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('passes when budget is found on server', async () => {
      const cfg = makeConfig();
      setupOnlineMocks(cfg);
      const results = await validator.validateOnline(cfg);
      expectCheck(results, 'actual.budget', 'pass');
      expect(pass(results).find(r => r.check === 'actual.budget')?.message)
        .toContain('found on server');
    });

    it('fails when budget is not found on server', async () => {
      const cfg = makeConfig();
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200 }) // server ping
        .mockResolvedValueOnce(budgetNotFoundMocks()[0])
        .mockResolvedValueOnce(budgetNotFoundMocks()[1]);
      vi.stubGlobal('fetch', fetchMock);
      const results = await validator.validateOnline(cfg);
      expectCheck(results, 'actual.budget', 'fail');
      expect(fail(results).find(r => r.check === 'actual.budget')?.message)
        .toContain('not found');
    });

    it('fails when login fails (no token returned)', async () => {
      const cfg = makeConfig();
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200 }) // server ping
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: async () => ({ data: {} }), // no token
        });
      vi.stubGlobal('fetch', fetchMock);
      const results = await validator.validateOnline(cfg);
      expectCheck(results, 'actual.budget', 'fail');
      expect(fail(results).find(r => r.check === 'actual.budget')?.message)
        .toContain('login failed');
    });

    it('fails on network error during budget check', async () => {
      const cfg = makeConfig();
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200 }) // server ping
        .mockRejectedValueOnce(new Error('ECONNRESET'));
      vi.stubGlobal('fetch', fetchMock);
      const results = await validator.validateOnline(cfg);
      expectCheck(results, 'actual.budget', 'fail');
      expect(fail(results).find(r => r.check === 'actual.budget')?.message)
        .toContain('ECONNRESET');
    });
  });

  // ─── validateAll with budget check (end-to-end report) ───

  describe('validateAll budget report', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('report shows PASS for correct syncId', async () => {
      const cfg = makeConfig();
      setupOnlineMocks(cfg);
      const results = await validator.validateAll(cfg);
      const report = validator.formatReport(results);
      expect(report).toContain('[PASS] Budget');
      expect(report).toContain('found on server');
      expect(report).toContain('All checks passed');
    });

    it('report shows FAIL for wrong syncId', async () => {
      const cfg = makeConfig();
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200 })
        .mockResolvedValueOnce(budgetNotFoundMocks()[0])
        .mockResolvedValueOnce(budgetNotFoundMocks()[1]);
      vi.stubGlobal('fetch', fetchMock);
      const results = await validator.validateAll(cfg);
      const report = validator.formatReport(results);
      expect(report).toContain('[FAIL] Budget');
      expect(report).toContain('not found');
      expect(report).not.toContain('All checks passed');
    });
  });

  // ─── summarizeCounts singular forms ───

  describe('summarizeCounts singular', () => {
    it('uses singular "error" for exactly 1 failure', () => {
      const results: ValidationResult[] = [
        { status: 'fail', check: 'a', message: 'bad' },
      ];
      expect(validator.formatReport(results)).toContain('1 error');
      expect(validator.formatReport(results)).not.toContain('errors');
    });

    it('uses singular "warning" for exactly 1 warning', () => {
      const results: ValidationResult[] = [
        { status: 'warn', check: 'a', message: 'warn' },
      ];
      expect(validator.formatReport(results)).toContain('1 warning');
      expect(validator.formatReport(results)).not.toContain('warnings');
    });
  });

  // ─── runValidateMode ───

  describe('runValidateMode', () => {
    beforeEach(() => vi.clearAllMocks());
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('returns 1 when config cannot be loaded', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('read error'); });

      const code = await runValidateMode();

      expect(code).toBe(1);
    });

    it('returns 1 when offline checks fail', async () => {
      const badConfig = {
        actual: {
          init: { dataDir: './data', password: TEST_CREDENTIAL_SHORT, serverURL: 'http://localhost:5006' },
          budget: { syncId: 'not-a-uuid', password: null },
        },
        banks: { discount: { id: '1', password: TEST_CREDENTIAL_SHORT, num: 'A', daysBack: 7,
          targets: [{ actualAccountId: VALID_UUID, reconcile: true, accounts: 'all' }] } },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(badConfig));
      vi.spyOn(console, 'log').mockImplementation(() => {});

      const code = await runValidateMode();

      expect(code).toBe(1);
    });

    it('returns 0 when all checks pass', async () => {
      const goodConfig = {
        actual: {
          init: { dataDir: './data', password: TEST_CREDENTIAL_SHORT, serverURL: 'http://localhost:5006' },
          budget: { syncId: VALID_UUID, password: null },
        },
        banks: { discount: { id: '1', password: TEST_CREDENTIAL_SHORT, num: 'A', daysBack: 7,
          targets: [{ actualAccountId: VALID_UUID, reconcile: true, accounts: 'all' }] } },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(goodConfig));
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200 }) // server ping
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: async () => ({ data: { token: 'tok' } }),
        }) // login
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: async () => ({ data: [{ groupId: VALID_UUID }] }),
        }); // list budgets
      vi.stubGlobal('fetch', fetchMock);

      const code = await runValidateMode();

      expect(code).toBe(0);
    });
  });
});
