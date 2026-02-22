import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AuditLogService } from '../../src/services/AuditLogService.js';
import { createTestSummary } from './helpers/testData.js';

const TEST_FILE = join(tmpdir(), `e2e-audit-log-${Date.now()}.json`);
let service: AuditLogService;

beforeEach(() => {
  service = new AuditLogService(TEST_FILE, 5);
  if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE);
});

afterEach(() => {
  if (existsSync(TEST_FILE)) unlinkSync(TEST_FILE);
});

describe('Audit Log E2E', () => {
  it('creates file and persists entry on record', () => {
    const summary = createTestSummary({ totalTransactions: 10 });
    service.record(summary);

    expect(existsSync(TEST_FILE)).toBe(true);
    const entries = service.getRecent(1);
    expect(entries).toHaveLength(1);
    expect(entries[0].totalTransactions).toBe(10);
    expect(entries[0].timestamp).toBeTruthy();
  });

  it('rotates entries when exceeding maxEntries', () => {
    for (let i = 0; i < 8; i++) {
      service.record(createTestSummary({ totalTransactions: i }));
    }

    const entries = service.getRecent(10);
    expect(entries).toHaveLength(5);
    expect(entries[0].totalTransactions).toBe(3);
    expect(entries[4].totalTransactions).toBe(7);
  });

  it('recovers gracefully from corrupted file', () => {
    writeFileSync(TEST_FILE, '{ invalid json !!!');

    const entries = service.getRecent(3);
    expect(entries).toHaveLength(0);

    service.record(createTestSummary());
    expect(service.getRecent(1)).toHaveLength(1);
  });
});
