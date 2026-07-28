/**
 * Resolves the app-OTP request file path shared by the portal (writer of
 * submitted codes) and the import child process (creator + reader). Mirrors the
 * device-token registry: `OTP_REQUESTS_PATH` overrides the default so both
 * processes point at one file on a shared volume.
 */
import { isAbsolute } from 'node:path';

import ConfigurationError from '../../Errors/ConfigurationError.js';

const DEFAULT_OTP_REQUESTS_PATH = '/app/data/otp-requests.json';

/**
 * Resolves the OTP-requests file path from `OTP_REQUESTS_PATH`, falling back to
 * the default Docker data path when the env var is unset or blank. A provided
 * override must be absolute so the portal and importer, which may run with
 * different working directories, resolve to the same shared file.
 * @returns The absolute OTP-requests file path.
 * @throws ConfigurationError when `OTP_REQUESTS_PATH` is set to a non-absolute path.
 */
export default function resolveOtpRequestsPath(): string {
  const override = process.env.OTP_REQUESTS_PATH?.trim();
  if (override === undefined || override.length === 0) {
    return DEFAULT_OTP_REQUESTS_PATH;
  }
  if (!isAbsolute(override)) {
    throw new ConfigurationError('OTP_REQUESTS_PATH must be an absolute path shared by the portal and importer');
  }
  return override;
}
