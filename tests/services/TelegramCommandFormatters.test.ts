import { describe, it, expect, vi } from 'vitest';
import {
  buildErrorAnnotations,
  formatBankError,
  formatAuditEntry,
  formatPartialSuccess,
  truncateForTelegram,
} from '../../src/Services/TelegramCommandFormatters.js';
import type { IAuditEntry, IAuditLog } from '../../src/Services/AuditLogService.js';
import { succeed } from '../../src/Types/ProcedureHelpers.js';
import type { IBankResultsState } from '../../src/Types/Pipeline/Index.js';

describe('TelegramCommandFormatters', () => {
  describe('buildErrorAnnotations', () => {
    it('shows critical warning when streak >= 5', () => {
      const lines = buildErrorAnnotations('Check password', 5);
      expect(lines).toContain('  \u{1F6A8} Failed 5+ times in a row \u2014 check credentials');
    });

    it('shows critical warning when streak > 5', () => {
      const lines = buildErrorAnnotations('', 7);
      expect(lines).toContain('  \u{1F6A8} Failed 5+ times in a row \u2014 check credentials');
      expect(lines).toHaveLength(1);
    });
  });

  describe('formatBankError', () => {
    it('formats bank error with error message', () => {
      const bank = { name: 'discount', status: 'failure', error: 'INVALID_PASSWORD', txns: 0 };
      const result = formatBankError(bank);
      expect(result).toContain('discount');
      expect(result).toContain('INVALID_PASSWORD');
    });

    it('formats bank error without error message', () => {
      const bank = { name: 'discount', status: 'failure', txns: 0 };
      const result = formatBankError(bank);
      expect(result).toContain('discount');
      expect(result).not.toContain(':');
    });

    it('includes streak from audit log when provided', () => {
      const bank = { name: 'discount', status: 'failure', error: 'Error', txns: 0 };
      const auditLog: IAuditLog = {
        record: vi.fn(),
        getRecent: vi.fn(),
        getLastFailedBanks: vi.fn(),
        getConsecutiveFailures: vi.fn().mockReturnValue(succeed(5)),
      };
      const result = formatBankError(bank, auditLog);
      expect(result).toContain('5+ times');
    });

    it('uses streak 0 when auditLog is undefined', () => {
      const bank = { name: 'discount', status: 'failure', error: 'Error', txns: 0 };
      const result = formatBankError(bank);
      expect(result).not.toContain('times in a row');
    });
  });

  describe('formatAuditEntry', () => {
    it('handles timestamp without T separator', () => {
      const entry: IAuditEntry = {
        timestamp: '2026-03-23',
        totalBanks: 1, successfulBanks: 1, failedBanks: 0,
        totalTransactions: 5, totalDuplicates: 0,
        totalDuration: 5000, successRate: 100,
        banks: [],
      };
      const result = formatAuditEntry(entry);
      expect(result).toContain('2026-03-23');
      expect(result).toContain('5 txns');
    });
  });

  describe('truncateForTelegram', () => {
    it('returns truncated text without newline when trimmed has no newline', () => {
      // Create a single very long line with no newlines so that after slicing
      // there is no newline to split on
      const longLine = 'A'.repeat(5000);
      const result = truncateForTelegram([longLine], 0);
      expect(result).toContain('...(earlier entries omitted)');
    });
  });

  describe('formatPartialSuccess', () => {
    /**
     * Builds an IBankResultsState fixture for partial-success tests.
     * @param quarantinedCount - Number of quarantine entries to synthesize.
     * @returns Frozen bank results state with 1 success + N quarantined.
     */
    function makeState(quarantinedCount: number): IBankResultsState {
      const quarantined = Array.from({ length: quarantinedCount }, (_, i) => ({
        bankName: `bank-${String(i)}`,
        stage: 'scrape' as const,
        error: new Error(`error-${String(i)}`),
        durationMs: 100,
      }));
      return {
        successful: [{ bankName: 'ok-bank', imported: 5, skipped: 0, durationMs: 200 }],
        quarantined,
        totalBanks: 1 + quarantinedCount,
      };
    }

    it('renders header with OK/total counts and duration', () => {
      const out = formatPartialSuccess(makeState(2), '12.34');
      expect(out).toContain('Partial success (12.34s)');
      expect(out).toContain('1/3 banks OK');
      expect(out).toContain('Quarantined:');
      expect(out).toContain('bank-0');
      expect(out).toContain('bank-1');
      expect(out).toContain('Use /retry to re-import quarantined banks.');
    });

    it('caps quarantined display at 10 and reports overflow', () => {
      const out = formatPartialSuccess(makeState(13), '1.00');
      expect(out).toContain('bank-0');
      expect(out).toContain('bank-9');
      expect(out).not.toContain('bank-10');
      expect(out).toContain('...and 3 more');
    });

    it('annotates each line with stage and truncated error', () => {
      const state: IBankResultsState = {
        successful: [],
        quarantined: [{
          bankName: 'leumi',
          stage: 'import',
          error: new Error('A'.repeat(200)),
          durationMs: 50,
        }],
        totalBanks: 1,
      };
      const out = formatPartialSuccess(state, '0.50');
      expect(out).toContain('leumi [import]');
      expect(out).toMatch(/A{80}(?!A)/);
    });

    it('includes streak annotation from audit log when provided', () => {
      const auditLog: IAuditLog = {
        record: vi.fn(),
        getRecent: vi.fn(),
        getLastFailedBanks: vi.fn(),
        getConsecutiveFailures: vi.fn().mockReturnValue(succeed(5)),
      };
      const state: IBankResultsState = {
        successful: [],
        quarantined: [{
          bankName: 'leumi',
          stage: 'scrape',
          error: new Error('boom'),
          durationMs: 10,
        }],
        totalBanks: 1,
      };
      const out = formatPartialSuccess(state, '0.1', auditLog);
      expect(out).toContain('5+ times');
    });

    it('omits overflow line when quarantine count is at or below the cap', () => {
      const out = formatPartialSuccess(makeState(10), '0.0');
      expect(out).not.toContain('...and');
    });
  });
});
