import { describe, expect, it } from 'vitest';

import {
  buildBatchErrorReply,
  buildHelpLines,
  buildHistoryLines,
  buildLogsFooter,
  buildLogsHeader,
  buildStatusLines,
} from '../../../src/Services/Telegram/ReplyBuilders.js';
import { fakeBatchResult, fakeIAuditEntry } from '../../helpers/factories.js';

describe('ReplyBuilders', () => {
  describe('buildHelpLines', () => {
    it('omits /import_receipt when no receipt handler', () => {
      const lines = buildHelpLines(false);
      expect(lines.some(l => l.includes('/import_receipt'))).toBe(false);
      expect(lines).toContain('/help - Show this message');
    });

    it('includes /import_receipt when receipt handler present', () => {
      const lines = buildHelpLines(true);
      expect(lines.some(l => l.includes('/import_receipt'))).toBe(true);
    });
  });

  describe('buildStatusLines', () => {
    it('shows "No imports run yet" when lastTime is null', () => {
      const lines = buildStatusLines({ lastTime: null, lastResult: null, isImporting: false });
      expect(lines.join('\n')).toContain('No imports run yet');
      expect(lines.join('\n')).toContain('idle');
    });

    it('shows success label when lastResult has zero failures', () => {
      const lines = buildStatusLines({
        lastTime: new Date(),
        lastResult: fakeBatchResult({ failureCount: 0 }),
        isImporting: false,
      });
      expect(lines.join('\n')).toContain('(success)');
    });

    it('shows failed label when lastResult has failures', () => {
      const lines = buildStatusLines({
        lastTime: new Date(),
        lastResult: fakeBatchResult({ failureCount: 1 }),
        isImporting: true,
      });
      const joined = lines.join('\n');
      expect(joined).toContain('(failed)');
      expect(joined).toContain('importing');
    });
  });

  describe('buildHistoryLines', () => {
    it('returns empty array on empty input without mutating', () => {
      const input: readonly never[] = [];
      const out = buildHistoryLines(input);
      expect(out).toEqual([]);
      expect(input.length).toBe(0);
    });

    it('does not mutate the input array', () => {
      const entries = [fakeIAuditEntry(), fakeIAuditEntry()];
      const snapshot = [...entries];
      buildHistoryLines(entries);
      expect(entries).toEqual(snapshot);
    });

    it('produces header and one line per entry', () => {
      const entries = [
        fakeIAuditEntry({ timestamp: '2026-01-01T10:00:00.000Z' }),
        fakeIAuditEntry({ timestamp: '2026-01-02T10:00:00.000Z' }),
      ];
      const out = buildHistoryLines(entries);
      expect(out[0]).toBe('');
      expect(out[1]).toContain('Recent imports');
      expect(out.length).toBe(2 + entries.length);
    });
  });

  describe('buildLogsHeader / buildLogsFooter', () => {
    it('header includes the entry count and opens <pre>', () => {
      expect(buildLogsHeader(42)).toContain('42 entries');
      expect(buildLogsHeader(42)).toContain('<pre>');
    });

    it('footer closes the <pre> block', () => {
      expect(buildLogsFooter()).toBe('</pre>');
    });
  });

  describe('buildBatchErrorReply', () => {
    it('returns generic reply when no entry is supplied', () => {
      const reply = buildBatchErrorReply({
        batch: fakeBatchResult({ failureCount: 1, totalDurationMs: 4000 }),
        entry: undefined, auditLog: undefined,
      });
      expect(reply).toContain('Import failed');
      expect(reply).toContain('/logs');
    });

    it('returns generic reply when entry is stale', () => {
      const reply = buildBatchErrorReply({
        batch: fakeBatchResult({ failureCount: 1, totalDurationMs: 1000 }),
        entry: fakeIAuditEntry({ timestamp: '2020-01-01T00:00:00.000Z' }),
        auditLog: undefined,
      });
      expect(reply).toContain('Use /logs for details');
    });

    it('returns detailed reply with bank list when entry is fresh', () => {
      const reply = buildBatchErrorReply({
        batch: fakeBatchResult({ failureCount: 1, totalDurationMs: 1000 }),
        entry: fakeIAuditEntry({
          totalBanks: 2, successfulBanks: 1, failedBanks: 1,
          banks: [{ name: 'discount', status: 'failure', error: 'Auth', txns: 0 }],
        }),
        auditLog: undefined,
      });
      expect(reply).toContain('discount');
      expect(reply).toContain('1/2 banks had errors');
    });
  });
});
