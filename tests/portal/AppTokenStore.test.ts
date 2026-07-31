import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TokenGrant } from '../../src/Portal/AppTokenStore.js';
import { AppTokenStore, DEFAULT_REFRESH_TTL_DAYS, resolveAppTokensPath } from '../../src/Portal/AppTokenStore.js';
import { isFail, isSuccess } from '../../src/Types/Index.js';

const NOW = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const GRANT: TokenGrant = {
  deviceName: 'Pixel 8',
  email: 'operator@example.com',
  factors: { google: true, password: true },
  fingerprint: 'fp',
};

describe('AppTokenStore', () => {
  let dir: string;
  let file: string;
  let store: AppTokenStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'app-tokens-'));
    file = join(dir, 'app-tokens.json');
    store = new AppTokenStore(file);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('resolveAppTokensPath', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('falls back to the shared data volume when unset', () => {
      vi.stubEnv('APP_TOKENS_PATH', undefined);
      expect(resolveAppTokensPath()).toBe('/app/data/app-tokens.json');
    });

    it('honours an explicit override', () => {
      vi.stubEnv('APP_TOKENS_PATH', '/custom/tokens.json');
      expect(resolveAppTokensPath()).toBe('/custom/tokens.json');
    });
  });

  describe('issue', () => {
    it('returns a base64url token and a loggable record id', () => {
      const issued = store.issue(GRANT, NOW);
      expect(issued.token).toMatch(/^[A-Za-z0-9\-_]{43}$/);
      expect(issued.record.id).toMatch(/^[A-Za-z0-9\-_]{22}$/);
      expect(issued.record.deviceName).toBe('Pixel 8');
    });

    it('expires the token after the configured lifetime', () => {
      const issued = store.issue(GRANT, NOW);
      expect(issued.record.expiresAt).toBe(NOW + DEFAULT_REFRESH_TTL_DAYS * DAY_MS);
    });

    it('honours a shorter configured lifetime', () => {
      const short = new AppTokenStore(file, 7);
      expect(short.issue(GRANT, NOW).record.expiresAt).toBe(NOW + 7 * DAY_MS);
    });

    it('never writes the plaintext token to disk', () => {
      const issued = store.issue(GRANT, NOW);
      const raw = readFileSync(file, 'utf8');
      expect(raw).not.toContain(issued.token);
      expect(raw).toContain(issued.record.tokenHash);
    });

    it('gives each device its own family', () => {
      const first = store.issue(GRANT, NOW);
      const second = store.issue({ ...GRANT, deviceName: 'iPhone' }, NOW);
      expect(first.record.familyId).not.toBe(second.record.familyId);
      expect(store.list(NOW)).toHaveLength(2);
    });
  });

  describe('findByToken', () => {
    it('finds a live record by its plaintext token', () => {
      const issued = store.issue(GRANT, NOW);
      expect(store.findByToken(issued.token, NOW)?.id).toBe(issued.record.id);
    });

    it('does not find an unknown token', () => {
      store.issue(GRANT, NOW);
      expect(store.findByToken('not-a-token', NOW)).toBeUndefined();
    });
  });

  describe('rotate', () => {
    it('replaces the token and keeps the family', () => {
      const issued = store.issue(GRANT, NOW);
      const result = store.rotate(issued.token, NOW + 1000);
      expect(isSuccess(result)).toBe(true);
      if (!isSuccess(result)) return;
      expect(result.data.token).not.toBe(issued.token);
      expect(result.data.record.familyId).toBe(issued.record.familyId);
      expect(result.data.record.deviceName).toBe('Pixel 8');
    });

    it('carries the authorization context forward', () => {
      const issued = store.issue(GRANT, NOW);
      const result = store.rotate(issued.token, NOW + 1000);
      if (!isSuccess(result)) throw new Error('expected rotation to succeed');
      expect(result.data.record.factors).toEqual({ google: true, password: true });
      expect(result.data.record.email).toBe('operator@example.com');
      expect(result.data.record.fingerprint).toBe('fp');
    });

    it('retires the presented token', () => {
      const issued = store.issue(GRANT, NOW);
      store.rotate(issued.token, NOW + 1000);
      expect(store.list(NOW + 1000)).toHaveLength(1);
    });

    it('rejects an unknown token', () => {
      const result = store.rotate('not-a-token', NOW);
      expect(isFail(result) && result.message).toBe('Unknown refresh token');
    });

    it('treats an expired token as one it has never heard of', () => {
      const issued = store.issue(GRANT, NOW);
      const later = NOW + DEFAULT_REFRESH_TTL_DAYS * DAY_MS + 1;
      const result = store.rotate(issued.token, later);
      expect(isFail(result) && result.message).toBe('Unknown refresh token');
    });

    it('revokes the whole family when a retired token is replayed', () => {
      const first = store.issue(GRANT, NOW);
      const second = store.rotate(first.token, NOW + 1000);
      if (!isSuccess(second)) throw new Error('expected rotation to succeed');
      const replay = store.rotate(first.token, NOW + 2000);
      expect(isFail(replay)).toBe(true);
      if (!isFail(replay)) return;
      expect(replay.status).toBe('reused');
      expect(replay.details).toContain(`id=${first.record.id}`);
      expect(store.list(NOW + 2000)).toHaveLength(0);
    });

    it('locks out the thief and the victim alike after a replay', () => {
      const first = store.issue(GRANT, NOW);
      const second = store.rotate(first.token, NOW + 1000);
      if (!isSuccess(second)) throw new Error('expected rotation to succeed');
      store.rotate(first.token, NOW + 2000);
      expect(isFail(store.rotate(second.data.token, NOW + 3000))).toBe(true);
    });
  });

  describe('revoke', () => {
    it('signs a device out and kills its replacements', () => {
      const first = store.issue(GRANT, NOW);
      const second = store.rotate(first.token, NOW + 1000);
      if (!isSuccess(second)) throw new Error('expected rotation to succeed');
      expect(store.revoke(second.data.record.id, NOW + 2000)).toBe(true);
      expect(store.list(NOW + 2000)).toHaveLength(0);
    });

    it('leaves other devices signed in', () => {
      const phone = store.issue(GRANT, NOW);
      store.issue({ ...GRANT, deviceName: 'iPhone' }, NOW);
      store.revoke(phone.record.id, NOW);
      expect(store.list(NOW).map((record) => record.deviceName)).toEqual(['iPhone']);
    });

    it('reports an unknown id', () => {
      expect(store.revoke('nope', NOW)).toBe(false);
    });

    it('counts only the records it actually revoked', () => {
      const issued = store.issue(GRANT, NOW);
      expect(store.revokeFamily(issued.record.familyId, NOW)).toBe(1);
      expect(store.revokeFamily(issued.record.familyId, NOW)).toBe(0);
    });
  });

  describe('list', () => {
    it('is empty before anything is issued', () => {
      expect(store.list(NOW)).toEqual([]);
    });

    it('omits expired records', () => {
      store.issue(GRANT, NOW);
      expect(store.list(NOW + DEFAULT_REFRESH_TTL_DAYS * DAY_MS + 1)).toEqual([]);
    });
  });

  describe('persistence', () => {
    it('survives a restart', () => {
      const issued = store.issue(GRANT, NOW);
      const reopened = new AppTokenStore(file);
      expect(reopened.findByToken(issued.token, NOW)?.id).toBe(issued.record.id);
    });

    it('treats a corrupt file as no sessions rather than crashing', () => {
      writeFileSync(file, 'not json at all');
      expect(store.list(NOW)).toEqual([]);
      expect(() => store.issue(GRANT, NOW)).not.toThrow();
    });

    it('drops hand-edited entries that are missing fields', () => {
      writeFileSync(file, JSON.stringify([{ id: 'x' }, 12, null]));
      expect(store.list(NOW)).toEqual([]);
    });

    it('prunes expired records from the file', () => {
      store.issue(GRANT, NOW);
      store.prune(NOW + DEFAULT_REFRESH_TTL_DAYS * DAY_MS + 1);
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([]);
    });

    it('leaves the file alone when nothing expired', () => {
      store.issue(GRANT, NOW);
      const before = readFileSync(file, 'utf8');
      store.prune(NOW + 1000);
      expect(readFileSync(file, 'utf8')).toBe(before);
    });
  });
});
