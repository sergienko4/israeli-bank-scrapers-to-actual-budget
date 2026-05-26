import { describe, expect, it, vi } from 'vitest';

import type { IAuditLog } from '../../../src/Services/AuditLogService.js';
import { createAuditQuery } from '../../../src/Services/Telegram/AuditQuery.js';
import { fail, succeed } from '../../../src/Types/Index.js';
import { fakeBatchResult, fakeIAuditEntry } from '../../helpers/factories.js';

/**
 * Builds a stub IAuditLog whose methods return the supplied Procedures.
 * @param overrides - Partial method overrides.
 * @returns IAuditLog stub.
 */
function stubAuditLog(overrides: Partial<IAuditLog> = {}): IAuditLog {
  return {
    record: vi.fn().mockReturnValue(succeed({ status: 'recorded' as const })),
    getRecent: vi.fn().mockReturnValue(succeed([])),
    getLastFailedBanks: vi.fn().mockReturnValue(succeed([])),
    getConsecutiveFailures: vi.fn().mockReturnValue(succeed(0)),
    ...overrides,
  };
}

describe('AuditQuery', () => {
  it('returns empty arrays / zero when no auditLog is supplied', () => {
    const q = createAuditQuery(undefined);
    expect(q.getRecent(5)).toEqual([]);
    expect(q.getLastFailedBanks()).toEqual([]);
    expect(q.getConsecutiveFailures('discount')).toBe(0);
  });

  it('getRecent unwraps a successful Procedure', () => {
    const entry = fakeIAuditEntry();
    const log = stubAuditLog({ getRecent: vi.fn().mockReturnValue(succeed([entry])) });
    const q = createAuditQuery(log);
    expect(q.getRecent(1)).toEqual([entry]);
  });

  it('getRecent returns empty array on Procedure failure', () => {
    const log = stubAuditLog({ getRecent: vi.fn().mockReturnValue(fail('boom')) });
    expect(createAuditQuery(log).getRecent(5)).toEqual([]);
  });

  it('getLastFailedBanks unwraps successful Procedure', () => {
    const log = stubAuditLog({
      getLastFailedBanks: vi.fn().mockReturnValue(succeed(['leumi'])),
    });
    expect(createAuditQuery(log).getLastFailedBanks()).toEqual(['leumi']);
  });

  it('getLastFailedBanks returns empty array on failure', () => {
    const log = stubAuditLog({
      getLastFailedBanks: vi.fn().mockReturnValue(fail('no')),
    });
    expect(createAuditQuery(log).getLastFailedBanks()).toEqual([]);
  });

  it('getConsecutiveFailures unwraps successful Procedure', () => {
    const log = stubAuditLog({
      getConsecutiveFailures: vi.fn().mockReturnValue(succeed(7)),
    });
    expect(createAuditQuery(log).getConsecutiveFailures('leumi')).toBe(7);
  });

  it('getFreshEntryFor returns the entry when timestamp is inside the batch window', () => {
    const fresh = fakeIAuditEntry({ timestamp: new Date().toISOString() });
    const log = stubAuditLog({ getRecent: vi.fn().mockReturnValue(succeed([fresh])) });
    const q = createAuditQuery(log);
    const out = q.getFreshEntryFor(fakeBatchResult({ totalDurationMs: 5000 }));
    expect(out.success).toBe(true);
    if (out.success) expect(out.data).toBe(fresh);
  });

  it('getFreshEntryFor fails for stale entry', () => {
    const stale = fakeIAuditEntry({ timestamp: '2020-01-01T00:00:00.000Z' });
    const log = stubAuditLog({ getRecent: vi.fn().mockReturnValue(succeed([stale])) });
    const q = createAuditQuery(log);
    expect(q.getFreshEntryFor(fakeBatchResult({ totalDurationMs: 1000 })).success).toBe(false);
  });

  it('getFreshEntryFor fails when there are no entries', () => {
    const q = createAuditQuery(stubAuditLog());
    expect(q.getFreshEntryFor(fakeBatchResult()).success).toBe(false);
  });
});
