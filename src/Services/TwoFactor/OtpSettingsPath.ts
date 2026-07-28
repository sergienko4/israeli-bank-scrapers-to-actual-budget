/**
 * Resolves the app-only OTP settings file path (the chosen OTP delivery
 * channel). Written by the portal from the mobile app and read by the import
 * child when selecting the OTP prompter. `OTP_SETTINGS_PATH` overrides the
 * default so both processes point at one file on a shared volume.
 */
import { isAbsolute } from 'node:path';

import ConfigurationError from '../../Errors/ConfigurationError.js';

const DEFAULT_OTP_SETTINGS_PATH = '/app/data/otp-settings.json';

/**
 * Resolves the OTP-settings file path from `OTP_SETTINGS_PATH`, falling back to
 * the default Docker data path when the env var is unset or blank. A provided
 * override must be absolute so the portal and importer, which may run with
 * different working directories, resolve to the same shared file.
 * @returns The absolute OTP-settings file path.
 * @throws ConfigurationError when `OTP_SETTINGS_PATH` is set to a non-absolute path.
 */
export default function resolveOtpSettingsPath(): string {
  const override = process.env.OTP_SETTINGS_PATH?.trim();
  if (override === undefined || override.length === 0) {
    return DEFAULT_OTP_SETTINGS_PATH;
  }
  if (!isAbsolute(override)) {
    throw new ConfigurationError('OTP_SETTINGS_PATH must be an absolute path shared by the portal and importer');
  }
  return override;
}
