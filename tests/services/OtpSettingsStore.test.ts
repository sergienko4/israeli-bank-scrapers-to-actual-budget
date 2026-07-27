import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import OtpSettingsStore from '../../src/Services/TwoFactor/OtpSettingsStore.js';

let dir: string;
let store: OtpSettingsStore;

/**
 * Path to the OTP-settings file in the current temp dir.
 * @returns The absolute file path.
 */
function settingsPath(): string {
  return join(dir, 'otp-settings.json');
}

describe('OtpSettingsStore', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'otp-settings-'));
    store = new OtpSettingsStore(settingsPath());
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('defaults to the telegram channel when no file exists', () => {
    expect(store.get()).toEqual({ channel: 'telegram' });
  });

  it('persists and reads the app channel', () => {
    store.set('app');
    expect(store.get()).toEqual({ channel: 'app' });
  });

  it('persists and reads the telegram channel', () => {
    store.set('telegram');
    expect(store.get()).toEqual({ channel: 'telegram' });
  });

  it('defaults to telegram on a corrupt file', () => {
    writeFileSync(settingsPath(), 'not-json');
    expect(store.get()).toEqual({ channel: 'telegram' });
  });

  it('defaults to telegram on an unknown channel value', () => {
    writeFileSync(settingsPath(), JSON.stringify({ channel: 'sms' }));
    expect(store.get()).toEqual({ channel: 'telegram' });
  });

  it('defaults to telegram when the file is not an object', () => {
    writeFileSync(settingsPath(), JSON.stringify('app'));
    expect(store.get()).toEqual({ channel: 'telegram' });
  });
});
