import { describe, it, expect, vi } from 'vitest';
import {
  buildErrorAnnotations,
  formatBankError,
  formatAuditEntry,
  truncateForTelegram,
} from '../../src/Services/TelegramCommandFormatters.js';
import type { IAuditEntry, IAuditLog } from '../../src/Services/AuditLogService.js';
import { succeed } from '../../src/Types/ProcedureHelpers.js';

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
});
