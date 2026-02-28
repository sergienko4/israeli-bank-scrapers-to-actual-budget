import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigValidator, ValidationResult, runValidateMode } from '../../src/Config/ConfigValidator.js';
import { ImporterConfig } from '../../src/Types/index.js';
import * as fs from 'fs';

vi.mock('fs');

const VALID_UUID = '12345678-1234-1234-1234-123456789abc';

function makeConfig(overrides: Record<string, unknown> = {}): ImporterConfig {
  return {
    actual: {
      init: { dataDir: './data', password: 'pass', serverURL: 'http://localhost:5006' },
      budget: { syncId: VALID_UUID, password: null },
    },
    banks: {
      discount: {
        id: '123', password: 'p', num: 'ABC', daysBack: 7,
        targets: [{ actualAccountId: VALID_UUID, reconcile: true, accounts: 'all' }],
      },
    },
    ...overrides,
  } as ImporterConfig;
}

function pass(results: ValidationResult[]): ValidationResult[] {
  return results.filter(r => r.status === 'pass');
}
function fail(results: ValidationResult[]): ValidationResult[] {
  return results.filter(r => r.status === 'fail');
}
function warn(results: ValidationResult[]): ValidationResult[] {
  return results.filter(r => r.status === 'warn');
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
      expect(pass(results).some(r => r.check === 'actual.password')).toBe(true);
    });

    it('fails when password empty', () => {
      const cfg = makeConfig();
      cfg.actual.init.password = '';
      const results = validator.validateOffline(cfg);
      expect(fail(results).some(r => r.check === 'actual.password')).toBe(true);
    });
  });

  describe('actual.syncId', () => {
    it('passes on valid UUID', () => {
      const results = validator.validateOffline(makeConfig());
      expect(pass(results).some(r => r.check === 'actual.syncId')).toBe(true);
    });

    it('fails on invalid UUID', () => {
      const cfg = makeConfig();
      cfg.actual.budget.syncId = 'not-a-uuid';
      const results = validator.validateOffline(cfg);
      expect(fail(results).some(r => r.check === 'actual.syncId')).toBe(true);
    });

    it('fails on empty syncId', () => {
      const cfg = makeConfig();
      cfg.actual.budget.syncId = '';
      const results = validator.validateOffline(cfg);
      expect(fail(results).some(r => r.check === 'actual.syncId')).toBe(true);
    });
  });

  describe('actual.serverURL', () => {
    it('passes on http URL', () => {
      const results = validator.validateOffline(makeConfig());
      expect(pass(results).some(r => r.check === 'actual.serverURL')).toBe(true);
    });

    it('passes on https URL', () => {
      const cfg = makeConfig();
      cfg.actual.init.serverURL = 'https://actual.example.com';
      const results = validator.validateOffline(cfg);
      expect(pass(results).some(r => r.check === 'actual.serverURL')).toBe(true);
    });

    it('fails on non-http URL', () => {
      const cfg = makeConfig();
      cfg.actual.init.serverURL = 'ftp://bad';
      const results = validator.validateOffline(cfg);
      expect(fail(results).some(r => r.check === 'actual.serverURL')).toBe(true);
    });

    it('fails and does not crash when serverURL is undefined (shallow-merge bug regression)', () => {
      // Simulates loadFullConfig() shallow spread stripping actual.init.serverURL
      // when credentials.json has an 'actual' section
      const cfg = makeConfig();
      (cfg.actual.init as Record<string, unknown>).serverURL = undefined;
      expect(() => validator.validateOffline(cfg)).not.toThrow();
      const results = validator.validateOffline(cfg);
      expect(fail(results).some(r => r.check === 'actual.serverURL')).toBe(true);
    });
  });

  // ─── Bank names ───

  describe('bank name validation', () => {
    it('passes for known bank', () => {
      const results = validator.validateOffline(makeConfig());
      expect(pass(results).some(r => r.check === 'bank.discount')).toBe(true);
    });

    it('passes for camelCase alias (oneZero)', () => {
      const cfg = makeConfig({
        banks: {
          oneZero: {
            email: 'a@b.com', password: 'p', phoneNumber: '+1234567890',
            targets: [{ actualAccountId: VALID_UUID, reconcile: true, accounts: 'all' }],
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
            password: 'p',
            targets: [{ actualAccountId: VALID_UUID, reconcile: true, accounts: 'all' }],
          },
        },
      });
      const results = validator.validateOffline(cfg);
      expect(fail(results).some(r => r.check === 'bank.unknownxyz')).toBe(true);
    });

    it('suggests "discount" for "disount" typo', () => {
      const cfg = makeConfig({
        banks: {
          disount: {
            id: '1', password: 'p', num: 'A',
            targets: [{ actualAccountId: VALID_UUID, reconcile: true, accounts: 'all' }],
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
            username: 'u', password: 'p',
            targets: [{ actualAccountId: VALID_UUID, reconcile: true, accounts: 'all' }],
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
            password: 'p',
            targets: [{ actualAccountId: VALID_UUID, reconcile: true, accounts: 'all' }],
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
            username: 'u', password: 'p',
            targets: [{ actualAccountId: VALID_UUID, reconcile: true, accounts: 'all' }],
          },
        },
      });
      const results = validator.validateOffline(cfg);
      expect(warn(results).some(r => r.check === 'bank.leumi.dates')).toBe(true);
    });

    it('fails when both startDate and daysBack are set', () => {
      const cfg = makeConfig({
        banks: {
          leumi: {
            username: 'u', password: 'p', daysBack: 7, startDate: '2026-01-01',
            targets: [{ actualAccountId: VALID_UUID, reconcile: true, accounts: 'all' }],
          },
        },
      });
      const results = validator.validateOffline(cfg);
      expect(fail(results).some(r => r.check === 'bank.leumi.dates')).toBe(true);
    });

    it('passes when only daysBack set', () => {
      const results = validator.validateOffline(makeConfig());
      expect(pass(results).some(r => r.check === 'bank.discount.dates')).toBe(true);
    });
  });

  // ─── Bank targets ───

  describe('bank targets', () => {
    it('fails when no targets', () => {
      const cfg = makeConfig({
        banks: { discount: { id: '1', password: 'p', num: 'A', daysBack: 7 } },
      });
      const results = validator.validateOffline(cfg);
      expect(fail(results).some(r => r.check === 'bank.discount.targets')).toBe(true);
    });

    it('fails on invalid UUID in actualAccountId', () => {
      const cfg = makeConfig({
        banks: {
          discount: {
            id: '1', password: 'p', num: 'A', daysBack: 7,
            targets: [{ actualAccountId: 'bad-uuid', reconcile: true, accounts: 'all' }],
          },
        },
      });
      const results = validator.validateOffline(cfg);
      expect(fail(results).some(r => r.check === 'bank.discount.target[0]')).toBe(true);
    });

    it('passes on valid target', () => {
      const results = validator.validateOffline(makeConfig());
      expect(pass(results).some(r => r.check === 'bank.discount.target[0]')).toBe(true);
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
      expect(fail(results).some(r => r.check === 'telegram.botToken')).toBe(true);
    });

    it('passes on valid Telegram botToken format', () => {
      const cfg = makeConfig({
        notifications: {
          enabled: true,
          telegram: { botToken: '123456789:ABCdef', chatId: '12345' },
        },
      });
      const results = validator.validateOffline(cfg);
      expect(pass(results).some(r => r.check === 'telegram.botToken')).toBe(true);
    });

    it('fails when Telegram chatId missing', () => {
      const cfg = makeConfig({
        notifications: {
          enabled: true,
          telegram: { botToken: '123456789:ABCdef', chatId: '' },
        },
      });
      const results = validator.validateOffline(cfg);
      expect(fail(results).some(r => r.check === 'telegram.chatId')).toBe(true);
    });

    it('fails on invalid webhook URL format', () => {
      const cfg = makeConfig({
        notifications: {
          enabled: true,
          webhook: { url: 'ftp://bad.com' },
        },
      });
      const results = validator.validateOffline(cfg);
      expect(fail(results).some(r => r.check === 'webhook.url')).toBe(true);
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
      expect(fail(results).some(r => r.check === 'webhook.url')).toBe(true);
    });

    it('passes on valid webhook URL', () => {
      const cfg = makeConfig({
        notifications: {
          enabled: true,
          webhook: { url: 'https://hooks.example.com/abc' },
        },
      });
      const results = validator.validateOffline(cfg);
      expect(pass(results).some(r => r.check === 'webhook.url')).toBe(true);
    });
  });

  // ─── No banks ───

  it('fails when banks is empty', () => {
    const cfg = makeConfig({ banks: {} });
    const results = validator.validateOffline(cfg);
    expect(fail(results).some(r => r.check === 'banks')).toBe(true);
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
    afterEach(() => vi.restoreAllMocks());

    it('passes when Actual server responds with 2xx', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
      const results = await validator.validateOnline(makeConfig());
      expect(pass(results).some(r => r.check === 'actual.server')).toBe(true);
    });

    it('fails when Actual server is unreachable', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
      const results = await validator.validateOnline(makeConfig());
      expect(fail(results).some(r => r.check === 'actual.server')).toBe(true);
    });

    it('checks Telegram token when notifications enabled', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200 }) // actual server
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: async () => ({ ok: true, result: { username: 'TestBot' } }),
        });
      vi.stubGlobal('fetch', fetchMock);
      const cfg = makeConfig({
        notifications: {
          enabled: true,
          telegram: { botToken: '123456789:ABCdef', chatId: '12345' },
        },
      });
      const results = await validator.validateOnline(cfg);
      expect(pass(results).some(r => r.check === 'telegram.token')).toBe(true);
      expect(pass(results).find(r => r.check === 'telegram.token')?.message)
        .toContain('@TestBot');
    });

    it('fails on invalid Telegram token', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200 }) // actual server
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: async () => ({ ok: false }),
        });
      vi.stubGlobal('fetch', fetchMock);
      const cfg = makeConfig({
        notifications: {
          enabled: true,
          telegram: { botToken: '000:bad', chatId: '12345' },
        },
      });
      const results = await validator.validateOnline(cfg);
      expect(fail(results).some(r => r.check === 'telegram.token')).toBe(true);
    });

    it('warns when webhook returns non-2xx on HEAD', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200 }) // actual server
        .mockResolvedValueOnce({ ok: false, status: 405 }); // webhook HEAD
      vi.stubGlobal('fetch', fetchMock);
      const cfg = makeConfig({
        notifications: {
          enabled: true,
          webhook: { url: 'https://hooks.example.com/x' },
        },
      });
      const results = await validator.validateOnline(cfg);
      expect(warn(results).some(r => r.check === 'webhook.url')).toBe(true);
    });

    it('skips online checks when offline has failures', async () => {
      const mockFetch = vi.fn();
      vi.stubGlobal('fetch', mockFetch);
      const cfg = makeConfig({ banks: {} }); // will fail offline
      const results = await validator.validateAll(cfg);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(fail(results).some(r => r.check === 'banks')).toBe(true);
    });

    it('fails when webhook URL is unreachable', async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200 }) // actual server
        .mockRejectedValueOnce(new Error('ECONNREFUSED')); // webhook
      vi.stubGlobal('fetch', fetchMock);
      const cfg = makeConfig({
        notifications: { enabled: true, webhook: { url: 'https://gone.example.com' } },
      });
      const results = await validator.validateOnline(cfg);
      expect(fail(results).some(r => r.check === 'webhook.url')).toBe(true);
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
    afterEach(() => vi.restoreAllMocks());

    it('returns 1 and prints [FAIL] when config cannot be loaded', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('read error'); });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const code = await runValidateMode();

      expect(code).toBe(1);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[FAIL]'));
    });

    it('returns 1 when offline checks fail', async () => {
      const badConfig = {
        actual: {
          init: { dataDir: './data', password: 'p', serverURL: 'http://localhost:5006' },
          budget: { syncId: 'not-a-uuid', password: null },
        },
        banks: { discount: { id: '1', password: 'p', num: 'A', daysBack: 7,
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
          init: { dataDir: './data', password: 'p', serverURL: 'http://localhost:5006' },
          budget: { syncId: VALID_UUID, password: null },
        },
        banks: { discount: { id: '1', password: 'p', num: 'A', daysBack: 7,
          targets: [{ actualAccountId: VALID_UUID, reconcile: true, accounts: 'all' }] } },
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(goodConfig));
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

      const code = await runValidateMode();

      expect(code).toBe(0);
    });
  });
});
