import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AuditLogService } from '../../src/Services/AuditLogService.js';
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
    const recordResult = service.record(summary);
    expect(recordResult.success).toBe(true);

    expect(existsSync(TEST_FILE)).toBe(true);
    const recentResult = service.getRecent(1);
    expect(recentResult.success).toBe(true);
    if (recentResult.success) {
      expect(recentResult.data).toHaveLength(1);
      expect(recentResult.data[0].totalTransactions).toBe(10);
      expect(recentResult.data[0].timestamp).toBeTruthy();
    }
  });

  it('rotates entries when exceeding maxEntries', () => {
    for (let i = 0; i < 8; i++) {
      service.record(createTestSummary({ totalTransactions: i }));
    }

    const recentResult = service.getRecent(10);
    expect(recentResult.success).toBe(true);
    if (recentResult.success) {
      expect(recentResult.data).toHaveLength(5);
      expect(recentResult.data[0].totalTransactions).toBe(3);
      expect(recentResult.data[4].totalTransactions).toBe(7);
    }
  });

  it('recovers gracefully from corrupted file', () => {
    writeFileSync(TEST_FILE, '{ invalid json !!!');

    const emptyResult = service.getRecent(3);
    expect(emptyResult.success).toBe(true);
    if (emptyResult.success) expect(emptyResult.data).toHaveLength(0);

    service.record(createTestSummary());
    const afterResult = service.getRecent(1);
    expect(afterResult.success).toBe(true);
    if (afterResult.success) expect(afterResult.data).toHaveLength(1);
  });
});
