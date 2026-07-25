import { afterEach, describe, expect, it } from 'vitest';

import resolveAuditLogPath from '../../src/Services/AuditLogPath.js';

const original = process.env.AUDIT_LOG_PATH;

describe('resolveAuditLogPath', () => {
  afterEach(() => {
    if (original === undefined) {
      delete process.env.AUDIT_LOG_PATH;
    } else {
      process.env.AUDIT_LOG_PATH = original;
    }
  });

  it('returns the default when the env var is unset', () => {
    delete process.env.AUDIT_LOG_PATH;
    expect(resolveAuditLogPath()).toBe('/app/data/audit-log.json');
  });

  it('returns the default when the env var is blank', () => {
    process.env.AUDIT_LOG_PATH = '   ';
    expect(resolveAuditLogPath()).toBe('/app/data/audit-log.json');
  });

  it('honors a configured path', () => {
    process.env.AUDIT_LOG_PATH = '/srv/shared/audit-log.json';
    expect(resolveAuditLogPath()).toBe('/srv/shared/audit-log.json');
  });
});
