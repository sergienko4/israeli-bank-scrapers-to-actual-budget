import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { INotificationConfig } from '../../src/Types/Index.js';
import EXPO_PUSH_NOTIFIER_FACTORY from '../../src/Services/Notifications/ExpoPushNotifierFactory.js';

const config = { enabled: true } as INotificationConfig;
const original = process.env.DEVICE_TOKENS_PATH;

describe('ExpoPushNotifierFactory', () => {
  afterEach(() => {
    if (original === undefined) {
      delete process.env.DEVICE_TOKENS_PATH;
    } else {
      process.env.DEVICE_TOKENS_PATH = original;
    }
  });

  it('does not apply when no device is registered', () => {
    const dir = mkdtempSync(join(tmpdir(), 'df-'));
    process.env.DEVICE_TOKENS_PATH = join(dir, 'none.json');
    expect(EXPO_PUSH_NOTIFIER_FACTORY.applies(config)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('applies when a device is registered', () => {
    const dir = mkdtempSync(join(tmpdir(), 'df-'));
    const path = join(dir, 'devices.json');
    writeFileSync(path, JSON.stringify(['ExponentPushToken[a]']));
    process.env.DEVICE_TOKENS_PATH = path;
    expect(EXPO_PUSH_NOTIFIER_FACTORY.applies(config)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a notifier and describes itself', () => {
    const notifier = EXPO_PUSH_NOTIFIER_FACTORY.create(config);
    expect(typeof notifier.sendSummary).toBe('function');
    expect(EXPO_PUSH_NOTIFIER_FACTORY.describe(config)).toContain('push');
  });
});
