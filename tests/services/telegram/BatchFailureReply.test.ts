/**
 * BatchFailureReply — regression tests for the "all banks failed" notification.
 *
 * The importer fans out ONE child process per bank and each child writes its
 * own audit entry with `totalBanks: 1`. The old reply was rendered from the
 * single most-recent audit entry, so a run where 1 of 5 banks failed was
 * announced as a total failure. These tests lock the batch-derived reply.
 */

import { describe, expect, it } from 'vitest';

import {
  buildBatchErrorReply,
  buildFailureHeader,
  failedBankLabels,
  indexBankErrors,
} from '../../../src/Services/Telegram/BatchFailureReply.js';
import {
  fakeBatchResult,
  fakeIAuditEntry,
  fakeImportJobResult,
} from '../../helpers/factories.js';

/**
 * Builds a batch where the named banks failed and the rest succeeded.
 * @param ok - Bank names whose child process exited 0.
 * @param failed - Bank names whose child process exited non-zero.
 * @returns IBatchResult with one job per bank, mirroring the real fan-out.
 */
function batchWith(ok: readonly string[], failed: readonly string[]) {
  const jobs = [
    ...ok.map(name => fakeImportJobResult(name, 0)),
    ...failed.map(name => fakeImportJobResult(name, 1)),
  ];
  return fakeBatchResult({
    jobs, totalDurationMs: 12000,
    successCount: ok.length, failureCount: failed.length,
  });
}

/**
 * Builds the per-bank audit entry a single child process would record.
 * @param name - Bank name imported by that child.
 * @param error - Error text when the bank failed, omitted when it succeeded.
 * @returns IAuditEntry describing that one bank.
 */
function entryFor(name: string, error?: string) {
  const status = error ? 'failure' as const : 'success' as const;
  return fakeIAuditEntry({
    totalBanks: 1, successfulBanks: error ? 0 : 1, failedBanks: error ? 1 : 0,
    banks: [{ name, status, error, txns: 0 }],
  });
}

describe('BatchFailureReply', () => {
  describe('failedBankLabels', () => {
    it('lists only the banks whose job exited non-zero', () => {
      const batch = batchWith(['leumi', 'discount'], ['paybox']);
      expect(failedBankLabels(batch)).toEqual(['paybox']);
    });

    it('returns nothing for an aggregate single-job batch', () => {
      const batch = fakeBatchResult({ jobs: [fakeImportJobResult('all', 1)], failureCount: 1 });
      expect(failedBankLabels(batch)).toEqual([]);
    });

    it('returns nothing when the batch carries no jobs', () => {
      expect(failedBankLabels(fakeBatchResult({ failureCount: 1 }))).toEqual([]);
    });
  });

  describe('buildFailureHeader', () => {
    it('announces a total failure when no bank succeeded', () => {
      expect(buildFailureHeader(3, 3, '9')).toContain('all 3 bank(s) failed');
    });

    it('announces a partial import when at least one bank succeeded', () => {
      const header = buildFailureHeader(5, 1, '9');
      expect(header).toContain('Partial import');
      expect(header).toContain('4/5 banks OK, 1 failed');
    });
  });

  describe('indexBankErrors', () => {
    it('maps each failed bank to its recorded error text', () => {
      const errors = indexBankErrors([entryFor('paybox', 'OTP timeout'), entryFor('leumi')]);
      expect(errors.get('paybox')).toBe('OTP timeout');
      expect(errors.has('leumi')).toBe(false);
    });
  });

  describe('buildBatchErrorReply', () => {
    it('does not claim a total failure when only one bank failed', () => {
      const reply = buildBatchErrorReply({
        batch: batchWith(['leumi', 'discount', 'max', 'isracard'], ['paybox']),
        entry: undefined, entries: [entryFor('paybox', 'OTP timeout')], auditLog: undefined,
      });
      expect(reply).toContain('Partial import');
      expect(reply).toContain('4/5 banks OK, 1 failed');
      expect(reply).not.toContain('Import failed');
    });

    it('names the failed bank and its error', () => {
      const reply = buildBatchErrorReply({
        batch: batchWith(['leumi'], ['paybox']),
        entry: undefined, entries: [entryFor('paybox', 'OTP timeout')], auditLog: undefined,
      });
      expect(reply).toContain('• paybox: OTP timeout');
      expect(reply).not.toContain('leumi');
    });

    it('still reports a total failure when every bank failed', () => {
      const reply = buildBatchErrorReply({
        batch: batchWith([], ['leumi', 'paybox']),
        entry: undefined, entries: [], auditLog: undefined,
      });
      expect(reply).toContain('all 2 bank(s) failed');
      expect(reply).toContain('• leumi');
      expect(reply).toContain('• paybox');
    });

    it('lists failed banks without error text when the audit entry is missing', () => {
      const reply = buildBatchErrorReply({
        batch: batchWith(['leumi'], ['paybox']),
        entry: undefined, entries: undefined, auditLog: undefined,
      });
      expect(reply).toContain('• paybox');
    });

    it('caps the failed-bank list and reports the overflow', () => {
      const failed = Array.from({ length: 13 }, (_, i) => `bank${String(i)}`);
      const reply = buildBatchErrorReply({
        batch: batchWith([], failed), entry: undefined, entries: [], auditLog: undefined,
      });
      expect(reply).toContain('...and 3 more');
      expect(reply).not.toContain('• bank10');
    });

    it('suggests /retry for the failed banks', () => {
      const reply = buildBatchErrorReply({
        batch: batchWith(['leumi'], ['paybox']),
        entry: undefined, entries: [], auditLog: undefined,
      });
      expect(reply).toContain('/retry');
    });

    it('falls back to the audit entry for aggregate batches', () => {
      const reply = buildBatchErrorReply({
        batch: fakeBatchResult({
          jobs: [fakeImportJobResult('all', 1)], failureCount: 1, totalDurationMs: 1000,
        }),
        entry: fakeIAuditEntry({
          totalBanks: 2, successfulBanks: 1, failedBanks: 1,
          banks: [{ name: 'discount', status: 'failure', error: 'Auth', txns: 0 }],
        }),
        entries: [], auditLog: undefined,
      });
      expect(reply).toContain('1/2 banks had errors');
      expect(reply).toContain('discount');
    });
  });
});
