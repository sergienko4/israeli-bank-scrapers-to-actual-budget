import { createHmac } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { isFail, isSuccess } from '../../src/Types/Index.js';
import { createSession, readSession } from '../../src/Portal/PortalSession.js';

const SECRET = 'portal-test-secret';
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

describe('PortalSession', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  describe('createSession', () => {
    it('returns a payload.sig token honouring the 12h TTL', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const before = Date.now();
      const token = createSession({ email: 'a@b.com', google: true, password: false, fingerprint: 'fp' }, SECRET);
      const [body, sig] = token.split('.');
      expect(body).toBeTruthy();
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
      const result = readSession(token, SECRET);
      if (!isSuccess(result)) throw new Error(result.message);
      expect(result.data.email).toBe('a@b.com');
      expect(result.data.google).toBe(true);
      expect(result.data.expires).toBeGreaterThanOrEqual(before + TWELVE_HOURS_MS);
      expect(result.data.expires).toBeLessThanOrEqual(before + TWELVE_HOURS_MS);
    });
  });

  describe('readSession', () => {
    it('succeeds for a freshly created token', () => {
      const token = createSession({ google: false, password: true, fingerprint: 'fp' }, SECRET);
      expect(isSuccess(readSession(token, SECRET))).toBe(true);
    });

    it('fails on a malformed token', () => {
      const result = readSession('no-dot-here', SECRET);
      expect(isFail(result)).toBe(true);
      if (isFail(result)) expect(result.message).toMatch(/Malformed/);
    });

    it('fails when the signature does not match', () => {
      const token = createSession({ google: false, password: true, fingerprint: 'fp' }, SECRET);
      const tampered = readSession(token, 'different-secret');
      expect(isFail(tampered)).toBe(true);
      if (isFail(tampered)) expect(tampered.message).toMatch(/Bad signature/);
    });

    it('fails (without throwing) on a validly-signed token whose body is not JSON', () => {
      const body = Buffer.from('not-json{').toString('base64url');
      const sig = createHmac('sha256', SECRET).update(body).digest('hex');
      const result = readSession(`${body}.${sig}`, SECRET);
      expect(isFail(result)).toBe(true);
      if (isFail(result)) expect(result.message).toMatch(/Malformed/);
    });

    it('fails on a validly-signed token whose payload shape is invalid', () => {
      const body = Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64url');
      const sig = createHmac('sha256', SECRET).update(body).digest('hex');
      const result = readSession(`${body}.${sig}`, SECRET);
      expect(isFail(result)).toBe(true);
      if (isFail(result)) expect(result.message).toMatch(/Malformed/);
    });

    it('rejects a validly-signed token that carries no credential fingerprint', () => {
      const stale = { google: false, password: true, expires: Date.now() + 1000 };
      const body = Buffer.from(JSON.stringify(stale)).toString('base64url');
      const sig = createHmac('sha256', SECRET).update(body).digest('hex');
      const result = readSession(`${body}.${sig}`, SECRET);
      expect(isFail(result)).toBe(true);
      if (isFail(result)) expect(result.message).toMatch(/Malformed/);
    });

    it('fails once the 12h TTL has elapsed', () => {
      const token = createSession({ google: true, password: true, fingerprint: 'fp' }, SECRET);
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + TWELVE_HOURS_MS + 1000);
      const result = readSession(token, SECRET);
      expect(isFail(result)).toBe(true);
      if (isFail(result)) expect(result.message).toMatch(/expired/);
    });
  });
});
