import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerAppSessionRoutes } from '../../src/Portal/AppSessionRoutes.js';
import { AppTokenStore, type IIssuedToken, type TokenGrant } from '../../src/Portal/AppTokenStore.js';
import { credentialFingerprint, type IPortalRuntime } from '../../src/Portal/PortalRuntime.js';
import { createSession } from '../../src/Portal/PortalSession.js';
import { fakePortalRuntime } from '../helpers/portalFactories.js';

const TTL_MS = 15 * 60 * 1000;

let app: FastifyInstance;
let tokens: AppTokenStore;
let runtime: IPortalRuntime;
let dir: string;

/**
 * Issues a refresh token the way a successful code exchange would.
 * @param overrides - Fields to override on the grant.
 * @returns The issued record and its clear token.
 */
function issue(overrides: Partial<TokenGrant> = {}): IIssuedToken {
  const fingerprint = credentialFingerprint(runtime);
  const grant: TokenGrant = {
    deviceName: 'Pixel',
    factors: { google: false, password: true },
    fingerprint,
    ...overrides,
  };
  return tokens.issue(grant);
}

/**
 * Mints the access token that a given refresh family would have produced.
 * @param family - Refresh-token family the access token belongs to.
 * @returns A bearer token value.
 */
function accessTokenFor(family: string): string {
  const claims = {
    google: false,
    password: true,
    fingerprint: credentialFingerprint(runtime),
    typ: 'access' as const,
    family,
  };
  return createSession(claims, runtime.sessionSecret, TTL_MS);
}

/**
 * Lists the sessions, optionally as a specific app session.
 * @param bearer - Access token to present, when the caller has one.
 * @returns The Fastify inject response.
 */
async function list(bearer?: string): Promise<LightMyRequestResponse> {
  const headers = bearer === undefined ? {} : { authorization: `Bearer ${bearer}` };
  return app.inject({ method: 'GET', url: '/api/app/sessions', headers });
}

describe('AppSessionRoutes', () => {
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'app-sessions-'));
    runtime = fakePortalRuntime();
    tokens = new AppTokenStore(join(dir, 'app-tokens.json'));
    app = Fastify({ logger: false });
    registerAppSessionRoutes(app, { live: () => runtime, tokens });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists nothing when no device has signed in', async () => {
    const res = await list();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('lists a signed-in device without exposing its secrets', async () => {
    const issued = issue({ deviceName: 'Pixel 8' });
    const res = await list();
    const [entry] = res.json();
    expect(entry.id).toBe(issued.record.id);
    expect(entry.deviceName).toBe('Pixel 8');
    expect(entry.issuedAt).toBeGreaterThan(0);
    expect(entry.expiresAt).toBeGreaterThan(entry.issuedAt);
    expect(Object.keys(entry).sort()).toEqual(
      ['current', 'deviceName', 'expiresAt', 'id', 'issuedAt', 'lastUsedAt'],
    );
  });

  it('marks the caller own session as current', async () => {
    const mine = issue({ deviceName: 'Mine' });
    issue({ deviceName: 'Other' });
    const res = await list(accessTokenFor(mine.record.familyId));
    const entries = res.json();
    const current = entries.filter((entry: { current: boolean }) => entry.current);
    expect(current).toHaveLength(1);
    expect(current[0].deviceName).toBe('Mine');
  });

  it('marks nothing as current for a browser caller', async () => {
    issue();
    const res = await list();
    expect(res.json()[0].current).toBe(false);
  });

  it('signs a device out along with every token it rotated through', async () => {
    const issued = issue();
    const rotated = tokens.rotate(issued.token);
    if (!rotated.success) throw new Error('rotation failed');
    const res = await app.inject({
      method: 'DELETE', url: `/api/app/sessions/${rotated.data.record.id}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(tokens.findByToken(issued.token)?.revokedAt).toBeGreaterThan(0);
    expect(tokens.list()).toHaveLength(0);
  });

  it('lists only the newest token of a rotated device', async () => {
    const issued = issue();
    const rotated = tokens.rotate(issued.token);
    if (!rotated.success) throw new Error('rotation failed');
    const res = await list();
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].id).toBe(rotated.data.record.id);
  });

  it('reports 404 for a session it does not hold', async () => {
    const res = await app.inject({
      method: 'DELETE', url: '/api/app/sessions/AAAAAAAAAAAAAAAAAAAAAA',
    });
    expect(res.statusCode).toBe(404);
  });

  it('reports 404 for an id that is not shaped like one', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/app/sessions/nope' });
    expect(res.statusCode).toBe(404);
  });
});
