import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetricsService } from '../../src/Services/MetricsService.js';

const mockLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock('../../src/Logger/index.js', () => ({
  getLogger: () => mockLogger,
  getLogBuffer: vi.fn(),
  createLogger: vi.fn(),
}));

describe('MetricsService', () => {
  let metrics: MetricsService;

  beforeEach(() => {
    vi.clearAllMocks();
    metrics = new MetricsService();
    metrics.startImport();
  });

  describe('startImport', () => {
    it('initializes the service', () => {
      const summary = metrics.getSummary();
      expect(summary.totalBanks).toBe(0);
    });

    it('clears previous data on re-init', () => {
      metrics.startBank('discount');
      metrics.recordBankSuccess('discount', 10, 5);

      metrics.startImport(); // Reset
      const summary = metrics.getSummary();
      expect(summary.totalBanks).toBe(0);
    });
  });

  describe('startBank / recordBankSuccess', () => {
    it('tracks a successful bank import', () => {
      metrics.startBank('discount');
      metrics.recordBankSuccess('discount', 10, 5);

      const summary = metrics.getSummary();
      expect(summary.totalBanks).toBe(1);
      expect(summary.successfulBanks).toBe(1);
      expect(summary.failedBanks).toBe(0);
      expect(summary.totalTransactions).toBe(10);
      expect(summary.totalDuplicates).toBe(5);
    });

    it('records duration', () => {
      metrics.startBank('discount');
      metrics.recordBankSuccess('discount', 5, 0);

      const bankMetrics = metrics.getBankMetrics('discount');
      expect(bankMetrics?.status).toBe('success');
      expect(bankMetrics?.duration).toBeDefined();
      expect(bankMetrics?.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('recordBankFailure', () => {
    it('tracks a failed bank import', () => {
      metrics.startBank('leumi');
      metrics.recordBankFailure('leumi', new Error('Auth failed'));

      const summary = metrics.getSummary();
      expect(summary.failedBanks).toBe(1);
      expect(summary.successfulBanks).toBe(0);
    });

    it('stores error name', () => {
      const error = new Error('Something broke');
      error.name = 'AuthenticationError';
      metrics.startBank('leumi');
      metrics.recordBankFailure('leumi', error);

      const bankMetrics = metrics.getBankMetrics('leumi');
      expect(bankMetrics?.error).toBe('AuthenticationError: Something broke');
    });

    it('does not expose "undefined" when scraper error message is sanitized to Unknown error', () => {
      // handleFailedScrape in index.ts sanitizes result.errorMessage === "undefined" → "Unknown error"
      // before calling recordBankFailure; this test verifies the downstream storage is clean
      metrics.startBank('visaCal');
      metrics.recordBankFailure('visaCal', new Error('Unknown error'));

      const bankMetrics = metrics.getBankMetrics('visaCal');
      expect(bankMetrics?.error).toBe('Error: Unknown error');
      expect(bankMetrics?.error).not.toContain('undefined');
    });
  });

  describe('recordReconciliation', () => {
    it('stores reconciliation status', () => {
      metrics.startBank('discount');
      metrics.recordReconciliation('discount', 'created', 5000);

      const bankMetrics = metrics.getBankMetrics('discount');
      expect(bankMetrics?.reconciliationStatus).toBe('created');
      expect(bankMetrics?.reconciliationAmount).toBe(5000);
    });

    it('stores skipped status', () => {
      metrics.startBank('discount');
      metrics.recordReconciliation('discount', 'skipped');

      const bankMetrics = metrics.getBankMetrics('discount');
      expect(bankMetrics?.reconciliationStatus).toBe('skipped');
    });
  });

  describe('getSummary', () => {
    it('calculates success rate correctly', () => {
      metrics.startBank('discount');
      metrics.recordBankSuccess('discount', 10, 0);

      metrics.startBank('leumi');
      metrics.recordBankFailure('leumi', new Error('Failed'));

      const summary = metrics.getSummary();
      expect(summary.successRate).toBe(50);
    });

    it('returns 0 success rate when no banks', () => {
      const summary = metrics.getSummary();
      expect(summary.successRate).toBe(0);
    });

    it('returns 100 success rate when all succeed', () => {
      metrics.startBank('discount');
      metrics.recordBankSuccess('discount', 5, 0);

      metrics.startBank('leumi');
      metrics.recordBankSuccess('leumi', 10, 2);

      const summary = metrics.getSummary();
      expect(summary.successRate).toBe(100);
    });

    it('aggregates transactions across banks', () => {
      metrics.startBank('discount');
      metrics.recordBankSuccess('discount', 10, 3);

      metrics.startBank('leumi');
      metrics.recordBankSuccess('leumi', 20, 5);

      const summary = metrics.getSummary();
      expect(summary.totalTransactions).toBe(30);
      expect(summary.totalDuplicates).toBe(8);
    });

    it('calculates average duration', () => {
      metrics.startBank('discount');
      metrics.recordBankSuccess('discount', 5, 0);

      const summary = metrics.getSummary();
      expect(summary.averageDuration).toBeGreaterThanOrEqual(0);
    });

    it('returns 0 average duration when no banks', () => {
      const summary = metrics.getSummary();
      expect(summary.averageDuration).toBe(0);
    });
  });

  describe('hasFailures', () => {
    it('returns false when all succeed', () => {
      metrics.startBank('discount');
      metrics.recordBankSuccess('discount', 5, 0);
      expect(metrics.hasFailures()).toBe(false);
    });

    it('returns true when a bank fails', () => {
      metrics.startBank('discount');
      metrics.recordBankFailure('discount', new Error('Failed'));
      expect(metrics.hasFailures()).toBe(true);
    });

    it('returns true when mixed success/failure', () => {
      metrics.startBank('discount');
      metrics.recordBankSuccess('discount', 5, 0);
      metrics.startBank('leumi');
      metrics.recordBankFailure('leumi', new Error('Failed'));
      expect(metrics.hasFailures()).toBe(true);
    });
  });

  describe('getBankMetrics', () => {
    it('returns undefined for unknown bank', () => {
      expect(metrics.getBankMetrics('nonexistent')).toBeUndefined();
    });

    it('returns metrics for known bank', () => {
      metrics.startBank('discount');
      const result = metrics.getBankMetrics('discount');
      expect(result).toBeDefined();
      expect(result?.bankName).toBe('discount');
      expect(result?.status).toBe('pending');
    });
  });

  describe('getErrorBreakdown', () => {
    it('returns empty object when no failures', () => {
      metrics.startBank('discount');
      metrics.recordBankSuccess('discount', 5, 0);
      expect(metrics.getErrorBreakdown()).toEqual({});
    });

    it('groups errors by type', () => {
      const authError = new Error('Auth failed');
      authError.name = 'AuthenticationError';

      const networkError = new Error('Connection lost');
      networkError.name = 'NetworkError';

      metrics.startBank('discount');
      metrics.recordBankFailure('discount', authError);

      metrics.startBank('leumi');
      metrics.recordBankFailure('leumi', networkError);

      metrics.startBank('hapoalim');
      metrics.recordBankFailure('hapoalim', authError);

      const breakdown = metrics.getErrorBreakdown();
      expect(breakdown['AuthenticationError: Auth failed']).toBe(2);
      expect(breakdown['NetworkError: Connection lost']).toBe(1);
    });
  });

  describe('printSummary', () => {
    it('prints without errors', () => {
      vi.clearAllMocks();

      metrics.startBank('discount');
      metrics.recordBankSuccess('discount', 10, 3);
      metrics.recordReconciliation('discount', 'created', 5000);

      metrics.printSummary();

      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('prints failed banks correctly', () => {
      vi.clearAllMocks();

      metrics.startBank('leumi');
      metrics.recordBankFailure('leumi', new Error('Auth failed'));

      metrics.printSummary();

      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('prints already-reconciled status', () => {
      vi.clearAllMocks();

      metrics.startBank('discount');
      metrics.recordBankSuccess('discount', 5, 0);
      metrics.recordReconciliation('discount', 'already-reconciled');

      metrics.printSummary();

      const calls = mockLogger.info.mock.calls.map(c => c[0]);
      expect(calls.some((c: string) => typeof c === 'string' && c.includes('already reconciled'))).toBe(true);
    });

    it('prints skipped/balanced reconciliation status', () => {
      vi.clearAllMocks();

      metrics.startBank('discount');
      metrics.recordBankSuccess('discount', 5, 0);
      metrics.recordReconciliation('discount', 'skipped');

      metrics.printSummary();

      const calls = mockLogger.info.mock.calls.map(c => c[0]);
      expect(calls.some((c: string) => typeof c === 'string' && c.includes('balanced'))).toBe(true);
    });

    it('prints negative reconciliation amount', () => {
      vi.clearAllMocks();

      metrics.startBank('discount');
      metrics.recordBankSuccess('discount', 5, 0);
      metrics.recordReconciliation('discount', 'created', -5000);

      metrics.printSummary();

      const calls = mockLogger.info.mock.calls.map(c => c[0]);
      expect(calls.some((c: string) => typeof c === 'string' && c.includes('-50.00'))).toBe(true);
    });

    it('prints with no banks', () => {
      vi.clearAllMocks();
      metrics.printSummary();
      expect(mockLogger.info).toHaveBeenCalled();
    });
  });

  describe('recordAccountTransactions', () => {
    it('stores accountName in AccountMetrics when provided', () => {
      metrics.startBank('discount');
      metrics.recordAccountTransactions('discount', {
        accountNumber: '1234567', accountName: 'Savings Account',
        balance: 10000, currency: 'ILS', newTransactions: [], existingTransactions: []
      });
      const bankMetrics = metrics.getBankMetrics('discount');
      expect(bankMetrics?.accounts[0].accountName).toBe('Savings Account');
    });

    it('stores undefined accountName when not provided', () => {
      metrics.startBank('discount');
      metrics.recordAccountTransactions('discount', {
        accountNumber: '1234567', balance: 10000, currency: 'ILS',
        newTransactions: [], existingTransactions: []
      });
      const bankMetrics = metrics.getBankMetrics('discount');
      expect(bankMetrics?.accounts[0].accountName).toBeUndefined();
    });
  });
});
