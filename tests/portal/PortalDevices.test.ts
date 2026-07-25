import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import PortalConfigStore from '../../src/Portal/PortalConfigStore.js';
import { buildPortal } from '../../src/Portal/PortalServer.js';
import { fakePortalRuntime, PORTAL_TEST_PASSWORD, seedConfigDir } from '../helpers/portalFactories.js';

let app: FastifyInstance;
let dir: string;
let devicesPath: string;
const originalDevicesPath = process.env.DEVICE_TOKENS_PATH;
const TOKEN = 'ExponentPushToken[abc123]';

/**
 * Logs in with the seeded portal password and returns the session cookie value.
 * @returns The portal_session cookie string.
 */
async function loginCookie(): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { password: PORTAL_TEST_PASSWORD } });
  return res.cookies[0].value;
}

describe('Portal /api/devices', () => {
  beforeEach(async () => {
    const seed = seedConfigDir();
    dir = mkdtempSync(join(tmpdir(), 'portal-dev-'));
    devicesPath = join(dir, 'devices.json');
    process.env.DEVICE_TOKENS_PATH = devicesPath;
    app = await buildPortal(fakePortalRuntime(), new PortalConfigStore(seed.path));
    rmSync(seed.dir, { recursive: true, force: true });
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
    if (originalDevicesPath === undefined) {
      delete process.env.DEVICE_TOKENS_PATH;
    } else {
      process.env.DEVICE_TOKENS_PATH = originalDevicesPath;
    }
  });

  it('guards /api/devices behind auth', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/devices', payload: { token: TOKEN } });
    expect(res.statusCode).toBe(401);
  });

  it('registers a valid Expo token', async () => {
    const cookie = await loginCookie();
    const res = await app.inject({
      method: 'POST', url: '/api/devices', cookies: { portal_session: cookie }, payload: { token: TOKEN },
    });
    expect(res.statusCode).toBe(200);
    expect(readFileSync(devicesPath, 'utf8')).toContain(TOKEN);
  });

  it('rejects an invalid token with 400', async () => {
    const cookie = await loginCookie();
    const res = await app.inject({
      method: 'POST', url: '/api/devices', cookies: { portal_session: cookie }, payload: { token: 'nope' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('unregisters a token', async () => {
    const cookie = await loginCookie();
    await app.inject({
      method: 'POST', url: '/api/devices', cookies: { portal_session: cookie }, payload: { token: TOKEN },
    });
    const del = await app.inject({
      method: 'DELETE', url: '/api/devices', cookies: { portal_session: cookie }, payload: { token: TOKEN },
    });
    expect(del.statusCode).toBe(200);
    expect(readFileSync(devicesPath, 'utf8')).not.toContain(TOKEN);
  });
});
