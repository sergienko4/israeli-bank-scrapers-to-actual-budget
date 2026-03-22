import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetricsService } from '../../src/Services/MetricsService.js';
import { fakeAccountTransactionsRecord } from '../helpers/factories.js';

const mockLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock('../../src/Logger/Index.js', () => ({
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
    it('returns succeed with status started', () => {
      const result = metrics.startImport();
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.status).toBe('started');
    });

    it('clears previous data on re-init', () => {
      metrics.startBank('discount');
      metrics.recordBankSuccess('discount', 10, 5);

      metrics.startImport(); // Reset
      const summaryResult = metrics.getSummary();
      expect(summaryResult.success).toBe(true);
      if (summaryResult.success) expect(summaryResult.data.totalBanks).toBe(0);
    });
  });

  describe('startBank / recordBankSuccess', () => {
    it('tracks a successful bank import', () => {
      const startResult = metrics.startBank('discount');
      expect(startResult.success).toBe(true);
      if (startResult.success) expect(startResult.data.status).toBe('tracking');

      const successResult = metrics.recordBankSuccess('discount', 10, 5);
      expect(successResult.success).toBe(true);
      if (successResult.success) expect(successResult.data.status).toBe('recorded');

      const summaryResult = metrics.getSummary();
      expect(summaryResult.success).toBe(true);
      if (summaryResult.success) {
        expect(summaryResult.data.totalBanks).toBe(1);
        expect(summaryResult.data.successfulBanks).toBe(1);
        expect(summaryResult.data.failedBanks).toBe(0);
        expect(summaryResult.data.totalTransactions).toBe(10);
        expect(summaryResult.data.totalDuplicates).toBe(5);
      }
    });

    it('records duration', () => {
      metrics.startBank('discount');
      metrics.recordBankSuccess('discount', 5, 0);

      const bankResult = metrics.getBankMetrics('discount');
      expect(bankResult.success).toBe(true);
      if (bankResult.success) {
        expect(bankResult.data.status).toBe('success');
        expect(bankResult.data.duration).toBeDefined();
        expect(bankResult.data.duration).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('recordBankFailure', () => {
    it('tracks a failed bank import', () => {
      metrics.startBank('leumi');
      const failResult = metrics.recordBankFailure('leumi', new Error('Auth failed'));
      expect(failResult.success).toBe(true);
      if (failResult.success) expect(failResult.data.status).toBe('recorded');

      const summaryResult = metrics.getSummary();
      expect(summaryResult.success).toBe(true);
      if (summaryResult.success) {
        expect(summaryResult.data.failedBanks).toBe(1);
        expect(summaryResult.data.successfulBanks).toBe(0);
      }
    });

    it('stores error name', () => {
      const error = new Error('Something broke');
      error.name = 'AuthenticationError';
      metrics.startBank('leumi');
      metrics.recordBankFailure('leumi', error);

      const bankResult = metrics.getBankMetrics('leumi');
      expect(bankResult.success).toBe(true);
      if (bankResult.success) {
        expect(bankResult.data.error).toBe('AuthenticationError: Something broke');
      }
    });

    it('does not expose "undefined" when scraper error message is sanitized to Unknown error', () => {
      metrics.startBank('visaCal');
      metrics.recordBankFailure('visaCal', new Error('Unknown error'));

      const bankResult = metrics.getBankMetrics('visaCal');
      expect(bankResult.success).toBe(true);
      if (bankResult.success) {
        expect(bankResult.data.error).toBe('Error: Unknown error');
        expect(bankResult.data.error).not.toContain('undefined');
      }
    });
  });

  describe('recordReconciliation', () => {
    it('stores reconciliation status', () => {
      metrics.startBank('discount');
      const reconResult = metrics.recordReconciliation('discount', 'created', 5000);
      expect(reconResult.success).toBe(true);
      if (reconResult.success) expect(reconResult.data.status).toBe('recorded');

      const bankResult = metrics.getBankMetrics('discount');
      expect(bankResult.success).toBe(true);
      if (bankResult.success) {
        expect(bankResult.data.reconciliationStatus).toBe('created');
        expect(bankResult.data.reconciliationAmount).toBe(5000);
      }
    });

    it('stores skipped status', () => {
      metrics.startBank('discount');
      metrics.recordReconciliation('discount', 'skipped');

      const bankResult = metrics.getBankMetrics('discount');
      expect(bankResult.success).toBe(true);
      if (bankResult.success) {
        expect(bankResult.data.reconciliationStatus).toBe('skipped');
      }
    });
  });

  describe('getSummary', () => {
    it('calculates success rate correctly', () => {
      metrics.startBank('discount');
      metrics.recordBankSuccess('discount', 10, 0);

      metrics.startBank('leumi');
      metrics.recordBankFailure('leumi', new Error('Failed'));

      const result = metrics.getSummary();
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.successRate).toBe(50);
    });

    it('returns 0 success rate when no banks', () => {
      const result = metrics.getSummary();
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.successRate).toBe(0);
    });

    it('returns 100 success rate when all succeed', () => {
      metrics.startBank('discount');
      metrics.recordBankSuccess('discount', 5, 0);

      metrics.startBank('leumi');
      metrics.recordBankSuccess('leumi', 10, 2);

      const result = metrics.getSummary();
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.successRate).toBe(100);
    });

    it('aggregates transactions across banks', () => {
      metrics.startBank('discount');
      metrics.recordBankSuccess('discount', 10, 3);

      metrics.startBank('leumi');
      metrics.recordBankSuccess('leumi', 20, 5);

      const result = metrics.getSummary();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.totalTransactions).toBe(30);
        expect(result.data.totalDuplicates).toBe(8);
      }
    });

    it('calculates average duration', () => {
      metrics.startBank('discount');
      metrics.recordBankSuccess('discount', 5, 0);

      const result = metrics.getSummary();
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.averageDuration).toBeGreaterThanOrEqual(0);
    });

    it('returns 0 average duration when no banks', () => {
      const result = metrics.getSummary();
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.averageDuration).toBe(0);
    });
  });

  describe('hasFailures', () => {
    it('returns succeed with false when all succeed', () => {
      metrics.startBank('discount');
      metrics.recordBankSuccess('discount', 5, 0);
      const result = metrics.hasFailures();
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBe(false);
    });

    it('returns succeed with true when a bank fails', () => {
      metrics.startBank('discount');
      metrics.recordBankFailure('discount', new Error('Failed'));
      const result = metrics.hasFailures();
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBe(true);
    });

    it('returns succeed with true when mixed success/failure', () => {
      metrics.startBank('discount');
      metrics.recordBankSuccess('discount', 5, 0);
      metrics.startBank('leumi');
      metrics.recordBankFailure('leumi', new Error('Failed'));
      const result = metrics.hasFailures();
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBe(true);
    });
  });

  describe('getBankMetrics', () => {
    it('returns fail for unknown bank', () => {
      const result = metrics.getBankMetrics('nonexistent');
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toBe('bank not found');
    });

    it('returns succeed with metrics for known bank', () => {
      metrics.startBank('discount');
      const result = metrics.getBankMetrics('discount');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.bankName).toBe('discount');
        expect(result.data.status).toBe('pending');
      }
    });
  });

  describe('getErrorBreakdown', () => {
    it('returns empty object when no failures', () => {
      metrics.startBank('discount');
      metrics.recordBankSuccess('discount', 5, 0);
      const result = metrics.getErrorBreakdown();
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual({});
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

      const result = metrics.getErrorBreakdown();
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data['AuthenticationError: Auth failed']).toBe(2);
        expect(result.data['NetworkError: Connection lost']).toBe(1);
      }
    });
  });

  describe('printSummary', () => {
    it('prints without errors and returns succeed', () => {
      vi.clearAllMocks();

      metrics.startBank('discount');
      metrics.recordBankSuccess('discount', 10, 3);
      metrics.recordReconciliation('discount', 'created', 5000);

      const result = metrics.printSummary();
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.status).toBe('printed');
      const calls = mockLogger.info.mock.calls.map(c => c[0]);
      expect(calls.some((c: string) => typeof c === 'string' && c.includes('discount'))).toBe(true);
    });

    it('prints failed banks correctly', () => {
      vi.clearAllMocks();

      metrics.startBank('leumi');
      metrics.recordBankFailure('leumi', new Error('Auth failed'));

      const result = metrics.printSummary();
      expect(result.success).toBe(true);
      const calls = mockLogger.info.mock.calls.map(c => c[0]);
      expect(calls.some((c: string) => typeof c === 'string' && c.includes('leumi'))).toBe(true);
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

    it('skips reconciliation line when created but amount is undefined', () => {
      vi.clearAllMocks();
      const startResult = metrics.startBank('discount');
      expect(startResult.success).toBe(true);
      const successResult = metrics.recordBankSuccess('discount', 5, 0);
      expect(successResult.success).toBe(true);
      const reconResult = metrics.recordReconciliation('discount', 'created');
      expect(reconResult.success).toBe(true);
      metrics.printSummary();
      const calls = mockLogger.info.mock.calls.map(c => c[0]);
      expect(calls.every((c: string) => typeof c !== 'string' || !c.includes('Reconciliation'))).toBe(true);
    });

    it('prints bank with no duration', () => {
      vi.clearAllMocks();
      const startResult = metrics.startBank('instant');
      expect(startResult.success).toBe(true);
      // Record success immediately — duration will be ~0ms
      const successResult = metrics.recordBankSuccess('instant', 1, 0);
      expect(successResult.success).toBe(true);
      metrics.printSummary();
      const calls = mockLogger.info.mock.calls.map(c => c[0]);
      expect(calls.some((c: string) => typeof c === 'string' && c.includes('instant'))).toBe(true);
    });

    it('prints with no banks', () => {
      vi.clearAllMocks();
      const result = metrics.printSummary();
      expect(result.success).toBe(true);
      const calls = mockLogger.info.mock.calls.map(c => c[0]);
      expect(calls.some((c: string) => typeof c === 'string' && c.includes('Summary'))).toBe(true);
    });
  });

  describe('recordAccountTransactions', () => {
    it('stores accountName in AccountMetrics when provided', () => {
      metrics.startBank('discount');
      const result = metrics.recordAccountTransactions(
        'discount', fakeAccountTransactionsRecord({ accountName: 'Savings Account' })
      );
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.status).toBe('recorded');

      const bankResult = metrics.getBankMetrics('discount');
      expect(bankResult.success).toBe(true);
      if (bankResult.success) {
        expect(bankResult.data.accounts[0].accountName).toBe('Savings Account');
      }
    });

    it('stores undefined accountName when not provided', () => {
      metrics.startBank('discount');
      metrics.recordAccountTransactions(
        'discount', fakeAccountTransactionsRecord({ accountName: undefined })
      );
      const bankResult = metrics.getBankMetrics('discount');
      expect(bankResult.success).toBe(true);
      if (bankResult.success) {
        expect(bankResult.data.accounts[0].accountName).toBeUndefined();
      }
    });
  });
});
