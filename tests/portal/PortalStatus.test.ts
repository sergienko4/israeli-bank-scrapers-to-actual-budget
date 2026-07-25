import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import PortalConfigStore from '../../src/Portal/PortalConfigStore.js';
import { buildPortal } from '../../src/Portal/PortalServer.js';
import { fakePortalRuntime, PORTAL_TEST_PASSWORD, seedConfigDir } from '../helpers/portalFactories.js';

let app: FastifyInstance;
let dir: string;
const originalAuditPath = process.env.AUDIT_LOG_PATH;

/**
 * Logs in with the seeded portal password and returns the session cookie value.
 * @returns The portal_session cookie string.
 */
async function loginCookie(): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: PORTAL_TEST_PASSWORD } });
  return res.cookies[0].value;
}

describe('Portal /api/status', () => {
  beforeEach(async () => {
    delete process.env.AUDIT_LOG_PATH;
    const seed = seedConfigDir();
    dir = seed.dir;
    app = await buildPortal(fakePortalRuntime(), new PortalConfigStore(seed.path));
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
    if (originalAuditPath === undefined) {
      delete process.env.AUDIT_LOG_PATH;
    } else {
      process.env.AUDIT_LOG_PATH = originalAuditPath;
    }
  });

  it('guards /api/status behind auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/status' });
    expect(res.statusCode).toBe(401);
  });

  it('returns an empty run list when no audit log exists', async () => {
    const cookie = await loginCookie();
    const res = await app.inject({ method: 'GET', url: '/api/status', cookies: { portal_session: cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ runs: [] });
  });

  it('returns recent runs from the configured audit log', async () => {
    const auditDir = mkdtempSync(join(tmpdir(), 'audit-'));
    const auditPath = join(auditDir, 'audit-log.json');
    const entry = {
      timestamp: '2026-07-25T00:00:00.000Z',
      totalBanks: 1,
      successfulBanks: 1,
      failedBanks: 0,
      totalTransactions: 3,
      totalDuplicates: 0,
      totalDuration: 1000,
      successRate: 100,
      banks: [{ name: 'leumi', status: 'success', duration: 900, txns: 3 }],
    };
    writeFileSync(auditPath, JSON.stringify([entry]), 'utf8');
    process.env.AUDIT_LOG_PATH = auditPath;

    const cookie = await loginCookie();
    const res = await app.inject({ method: 'GET', url: '/api/status', cookies: { portal_session: cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0].banks[0].name).toBe('leumi');
    rmSync(auditDir, { recursive: true, force: true });
  });
});
