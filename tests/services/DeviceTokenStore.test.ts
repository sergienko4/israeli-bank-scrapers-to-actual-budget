import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import DeviceTokenStore from '../../src/Services/Notifications/DeviceTokenStore.js';

let dir: string;
let store: DeviceTokenStore;

/**
 * Path to the device-tokens file in the current temp dir.
 * @returns The absolute file path.
 */
function tokenPath(): string {
  return join(dir, 'devices.json');
}

describe('DeviceTokenStore', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'devices-'));
    store = new DeviceTokenStore(tokenPath());
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists empty when no file exists', () => {
    expect(store.list()).toEqual([]);
  });

  it('adds and lists a token', () => {
    store.add('ExponentPushToken[abc]');
    expect(store.list()).toEqual(['ExponentPushToken[abc]']);
  });

  it('deduplicates repeated tokens', () => {
    store.add('t');
    store.add('t');
    expect(store.list()).toEqual(['t']);
  });

  it('removes a token', () => {
    store.add('a');
    store.add('b');
    store.remove('a');
    expect(store.list()).toEqual(['b']);
  });

  it('returns empty on a corrupt file', () => {
    writeFileSync(tokenPath(), 'not-json');
    expect(store.list()).toEqual([]);
  });

  it('returns empty when the file is not a JSON array', () => {
    writeFileSync(tokenPath(), JSON.stringify({ token: 'x' }));
    expect(store.list()).toEqual([]);
  });

  it('ignores non-string entries', () => {
    writeFileSync(tokenPath(), JSON.stringify(['a', 1, 'b']));
    expect(store.list()).toEqual(['a', 'b']);
  });
});
