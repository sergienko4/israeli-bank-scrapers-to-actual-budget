import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import OtpRequestStore from '../../src/Services/TwoFactor/OtpRequestStore.js';

let dir: string;
let store: OtpRequestStore;

/**
 * Path to the OTP-requests file in the current temp dir.
 * @returns The absolute file path.
 */
function requestsPath(): string {
  return join(dir, 'otp-requests.json');
}

describe('OtpRequestStore', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'otp-'));
    store = new OtpRequestStore(requestsPath());
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists no pending requests when no file exists', () => {
    expect(store.pending()).toEqual([]);
    expect(store.get('missing')).toBeNull();
  });

  it('creates a pending request and returns it without a code', () => {
    const created = store.create('leumi', 60_000, 1_000);
    expect(created.bankId).toBe('leumi');
    expect(created.code).toBeUndefined();
    const pending = store.pending(1_000);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe(created.id);
  });

  it('reads a created request by id', () => {
    const created = store.create('hapoalim', 60_000, 1_000);
    expect(store.get(created.id)?.bankId).toBe('hapoalim');
  });

  it('submits a code, hides it from pending, and exposes it via get', () => {
    const created = store.create('leumi', 60_000, 1_000);
    expect(store.submit(created.id, '123456', 2_000)).toBe(true);
    expect(store.pending(2_000)).toEqual([]);
    expect(store.get(created.id)?.code).toBe('123456');
  });

  it('rejects a submit for an unknown id', () => {
    expect(store.submit('nope', '123456')).toBe(false);
  });

  it('rejects a submit for an expired request', () => {
    const created = store.create('leumi', 10_000, 1_000);
    expect(store.submit(created.id, '123456', 999_999)).toBe(false);
  });

  it('rejects a second submit for an already-submitted request', () => {
    const created = store.create('leumi', 60_000, 1_000);
    store.submit(created.id, '111111', 2_000);
    expect(store.submit(created.id, '222222', 3_000)).toBe(false);
    expect(store.get(created.id)?.code).toBe('111111');
  });

  it('removes a request', () => {
    const created = store.create('leumi', 60_000, 1_000);
    store.remove(created.id);
    expect(store.get(created.id)).toBeNull();
  });

  it('excludes expired requests from pending', () => {
    store.create('leumi', 10_000, 1_000);
    expect(store.pending(999_999)).toEqual([]);
  });

  it('prunes expired requests when a new one is created', () => {
    const stale = store.create('leumi', 10_000, 1_000);
    const fresh = store.create('discount', 60_000, 999_999);
    expect(store.get(stale.id)).toBeNull();
    expect(store.get(fresh.id)?.bankId).toBe('discount');
  });

  it('returns empty on a corrupt file', () => {
    writeFileSync(requestsPath(), 'not-json');
    expect(store.pending()).toEqual([]);
  });

  it('ignores malformed entries', () => {
    writeFileSync(requestsPath(), JSON.stringify([{ id: 'x' }, 42, { id: 'ok', bankId: 'b', createdAt: 1, deadline: 9_999_999_999_999 }]));
    const pending = store.pending(1_000);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe('ok');
  });
});
