import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuditLogService } from '../../src/Services/AuditLogService.js';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { fakeImportSummary } from '../helpers/factories.js';

const TEST_FILE = '/tmp/test-audit-log.json';

describe('AuditLogService', () => {
  let service: AuditLogService;

  beforeEach(() => {
    service = new AuditLogService(TEST_FILE, 5);
    if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE);
  });

  afterEach(() => {
    if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE);
  });

  it('creates file on first record and returns succeed', () => {
    const result = service.record(fakeImportSummary());
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('recorded');
    expect(existsSync(TEST_FILE)).toBe(true);
  });

  it('records entry with correct fields', () => {
    service.record(fakeImportSummary({ totalTransactions: 10, successRate: 75 }));
    const entries = JSON.parse(readFileSync(TEST_FILE, 'utf8'));
    expect(entries).toHaveLength(1);
    expect(entries[0].totalTransactions).toBe(10);
    expect(entries[0].successRate).toBe(75);
    expect(entries[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('appends multiple entries', () => {
    service.record(fakeImportSummary());
    service.record(fakeImportSummary());
    service.record(fakeImportSummary());
    const entries = JSON.parse(readFileSync(TEST_FILE, 'utf8'));
    expect(entries).toHaveLength(3);
  });

  it('rotates entries when exceeding maxEntries', () => {
    for (let i = 0; i < 7; i++) service.record(fakeImportSummary({ totalTransactions: i }));
    const entries = JSON.parse(readFileSync(TEST_FILE, 'utf8'));
    expect(entries).toHaveLength(5);
    expect(entries[0].totalTransactions).toBe(2); // oldest kept
    expect(entries[4].totalTransactions).toBe(6); // newest
  });

  it('getRecent returns last N entries wrapped in Procedure', () => {
    for (let i = 0; i < 5; i++) service.record(fakeImportSummary({ totalTransactions: i }));
    const result = service.getRecent(2);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0].totalTransactions).toBe(3);
      expect(result.data[1].totalTransactions).toBe(4);
    }
  });

  it('getRecent returns empty array when no file', () => {
    const result = service.getRecent(5);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual([]);
  });

  it('handles corrupted file gracefully', () => {
    writeFileSync(TEST_FILE, 'not json');
    service.record(fakeImportSummary());
    const entries = JSON.parse(readFileSync(TEST_FILE, 'utf8'));
    expect(entries).toHaveLength(1);
  });

  it('maps bank metrics to audit entry', () => {
    const summary = fakeImportSummary({
      banks: [{
        bankName: 'discount', startTime: 0, status: 'success',
        transactionsImported: 5, transactionsSkipped: 2, accounts: [],
      }]
    });
    service.record(summary);
    const entries = JSON.parse(readFileSync(TEST_FILE, 'utf8'));
    expect(entries[0].banks[0]).toEqual({ name: 'discount', status: 'success', txns: 5 });
  });

  it('includes reconciliation fields when present', () => {
    const summary = fakeImportSummary({
      banks: [{
        bankName: 'discount', startTime: 0, status: 'success',
        transactionsImported: 3, transactionsSkipped: 0, accounts: [],
        reconciliationStatus: 'created', reconciliationAmount: 1500,
      }]
    });
    service.record(summary);
    const entries = JSON.parse(readFileSync(TEST_FILE, 'utf8'));
    expect(entries[0].banks[0].reconciliationStatus).toBe('created');
    expect(entries[0].banks[0].reconciliationAmount).toBe(1500);
  });

  it('omits reconciliation fields when not present', () => {
    const summary = fakeImportSummary({
      banks: [{
        bankName: 'leumi', startTime: 0, status: 'success',
        transactionsImported: 2, transactionsSkipped: 0, accounts: [],
      }]
    });
    service.record(summary);
    const entries = JSON.parse(readFileSync(TEST_FILE, 'utf8'));
    expect(entries[0].banks[0]).not.toHaveProperty('reconciliationStatus');
    expect(entries[0].banks[0]).not.toHaveProperty('reconciliationAmount');
  });

  // ─── getLastFailedBanks ───

  it('getLastFailedBanks returns failed bank names', () => {
    service.record(fakeImportSummary({
      banks: [
        { bankName: 'discount', startTime: 0, status: 'failure', error: 'Auth', transactionsImported: 0, transactionsSkipped: 0, accounts: [] },
        { bankName: 'leumi', startTime: 0, status: 'success', transactionsImported: 5, transactionsSkipped: 0, accounts: [] },
        { bankName: 'amex', startTime: 0, status: 'failure', error: 'Timeout', transactionsImported: 0, transactionsSkipped: 0, accounts: [] },
      ],
    }));
    const result = service.getLastFailedBanks();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(['discount', 'amex']);
  });

  it('getLastFailedBanks returns empty when all succeeded', () => {
    service.record(fakeImportSummary({
      banks: [
        { bankName: 'discount', startTime: 0, status: 'success', transactionsImported: 3, transactionsSkipped: 0, accounts: [] },
      ],
    }));
    const result = service.getLastFailedBanks();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual([]);
  });

  it('getLastFailedBanks returns empty when no entries', () => {
    const result = service.getLastFailedBanks();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual([]);
  });

  // ─── getConsecutiveFailures ───

  it('getConsecutiveFailures counts streak correctly', () => {
    for (let i = 0; i < 3; i++) {
      service.record(fakeImportSummary({
        banks: [{ bankName: 'discount', startTime: 0, status: 'failure', error: 'E', transactionsImported: 0, transactionsSkipped: 0, accounts: [] }],
      }));
    }
    const result = service.getConsecutiveFailures('discount');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(3);
  });

  it('getConsecutiveFailures stops at first success', () => {
    service.record(fakeImportSummary({
      banks: [{ bankName: 'discount', startTime: 0, status: 'failure', error: 'E', transactionsImported: 0, transactionsSkipped: 0, accounts: [] }],
    }));
    service.record(fakeImportSummary({
      banks: [{ bankName: 'discount', startTime: 0, status: 'success', transactionsImported: 1, transactionsSkipped: 0, accounts: [] }],
    }));
    service.record(fakeImportSummary({
      banks: [{ bankName: 'discount', startTime: 0, status: 'failure', error: 'E', transactionsImported: 0, transactionsSkipped: 0, accounts: [] }],
    }));
    service.record(fakeImportSummary({
      banks: [{ bankName: 'discount', startTime: 0, status: 'failure', error: 'E', transactionsImported: 0, transactionsSkipped: 0, accounts: [] }],
    }));
    const result = service.getConsecutiveFailures('discount');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(2);
  });

  it('getConsecutiveFailures returns 0 when bank always succeeds', () => {
    service.record(fakeImportSummary({
      banks: [{ bankName: 'discount', startTime: 0, status: 'success', transactionsImported: 5, transactionsSkipped: 0, accounts: [] }],
    }));
    const result = service.getConsecutiveFailures('discount');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(0);
  });

  it('getConsecutiveFailures returns 0 for unknown bank', () => {
    service.record(fakeImportSummary({
      banks: [{ bankName: 'discount', startTime: 0, status: 'failure', error: 'E', transactionsImported: 0, transactionsSkipped: 0, accounts: [] }],
    }));
    const result = service.getConsecutiveFailures('unknownBank');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(0);
  });

  it('getConsecutiveFailures handles empty log', () => {
    const result = service.getConsecutiveFailures('discount');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe(0);
  });
});
