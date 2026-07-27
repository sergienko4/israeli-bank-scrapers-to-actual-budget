import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import OtpPrompterWiring from '../../src/Importer/OtpPrompterWiring.js';
import AppOtpPrompter from '../../src/Services/TwoFactor/AppOtpPrompter.js';
import FallbackOtpPrompter from '../../src/Services/TwoFactor/FallbackOtpPrompter.js';
import OtpSettingsStore from '../../src/Services/TwoFactor/OtpSettingsStore.js';
import TwoFactorService from '../../src/Services/TwoFactorService.js';
import type { IImporterConfig } from '../../src/Types/Index.js';

let dir: string;
const originalSettingsPath = process.env.OTP_SETTINGS_PATH;

const withTelegram = {
  notifications: { telegram: { botToken: 'token', chatId: 'chat' } },
} as unknown as IImporterConfig;
const withoutTelegram = { notifications: {} } as unknown as IImporterConfig;

describe('new OtpPrompterWiring().resolve', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'otp-wiring-'));
    process.env.OTP_SETTINGS_PATH = join(dir, 'otp-settings.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (originalSettingsPath === undefined) {
      delete process.env.OTP_SETTINGS_PATH;
    } else {
      process.env.OTP_SETTINGS_PATH = originalSettingsPath;
    }
  });

  it('returns null when the channel is telegram and telegram is unconfigured', () => {
    expect(new OtpPrompterWiring().resolve(withoutTelegram)).toBeNull();
  });

  it('returns the telegram prompter when the channel is telegram', () => {
    expect(new OtpPrompterWiring().resolve(withTelegram)).toBeInstanceOf(TwoFactorService);
  });

  it('returns the app prompter when the channel is app and telegram is unconfigured', () => {
    new OtpSettingsStore().set('app');
    expect(new OtpPrompterWiring().resolve(withoutTelegram)).toBeInstanceOf(AppOtpPrompter);
  });

  it('wraps app + telegram in a fallback prompter when the channel is app', () => {
    new OtpSettingsStore().set('app');
    expect(new OtpPrompterWiring().resolve(withTelegram)).toBeInstanceOf(FallbackOtpPrompter);
  });
});
