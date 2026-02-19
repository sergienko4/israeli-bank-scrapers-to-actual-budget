import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuditLogService } from '../../src/services/AuditLogService.js';
import { ImportSummary } from '../../src/services/MetricsService.js';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';

const TEST_FILE = '/tmp/test-audit-log.json';

function makeSummary(overrides: Partial<ImportSummary> = {}): ImportSummary {
  return {
    totalBanks: 2, successfulBanks: 2, failedBanks: 0,
    totalTransactions: 5, totalDuplicates: 3, totalDuration: 10000,
    averageDuration: 5000, successRate: 100, banks: [],
    ...overrides,
  };
}

describe('AuditLogService', () => {
  let service: AuditLogService;

  beforeEach(() => {
    service = new AuditLogService(TEST_FILE, 5);
    if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE);
  });

  afterEach(() => {
    if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE);
  });

  it('creates file on first record', () => {
    service.record(makeSummary());
    expect(existsSync(TEST_FILE)).toBe(true);
  });

  it('records entry with correct fields', () => {
    service.record(makeSummary({ totalTransactions: 10, successRate: 75 }));
    const entries = JSON.parse(readFileSync(TEST_FILE, 'utf8'));
    expect(entries).toHaveLength(1);
    expect(entries[0].totalTransactions).toBe(10);
    expect(entries[0].successRate).toBe(75);
    expect(entries[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('appends multiple entries', () => {
    service.record(makeSummary());
    service.record(makeSummary());
    service.record(makeSummary());
    const entries = JSON.parse(readFileSync(TEST_FILE, 'utf8'));
    expect(entries).toHaveLength(3);
  });

  it('rotates entries when exceeding maxEntries', () => {
    for (let i = 0; i < 7; i++) service.record(makeSummary({ totalTransactions: i }));
    const entries = JSON.parse(readFileSync(TEST_FILE, 'utf8'));
    expect(entries).toHaveLength(5);
    expect(entries[0].totalTransactions).toBe(2); // oldest kept
    expect(entries[4].totalTransactions).toBe(6); // newest
  });

  it('getRecent returns last N entries', () => {
    for (let i = 0; i < 5; i++) service.record(makeSummary({ totalTransactions: i }));
    const recent = service.getRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0].totalTransactions).toBe(3);
    expect(recent[1].totalTransactions).toBe(4);
  });

  it('getRecent returns empty array when no file', () => {
    expect(service.getRecent(5)).toEqual([]);
  });

  it('handles corrupted file gracefully', () => {
    writeFileSync(TEST_FILE, 'not json');
    service.record(makeSummary());
    const entries = JSON.parse(readFileSync(TEST_FILE, 'utf8'));
    expect(entries).toHaveLength(1);
  });

  it('maps bank metrics to audit entry', () => {
    const summary = makeSummary({
      banks: [{
        bankName: 'discount', startTime: 0, status: 'success',
        transactionsImported: 5, transactionsSkipped: 2, accounts: [],
      }]
    });
    service.record(summary);
    const entries = JSON.parse(readFileSync(TEST_FILE, 'utf8'));
    expect(entries[0].banks[0]).toEqual({ name: 'discount', status: 'success', txns: 5 });
  });
});
