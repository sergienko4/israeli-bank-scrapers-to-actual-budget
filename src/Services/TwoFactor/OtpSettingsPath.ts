/**
 * Resolves the app-only OTP settings file path (the chosen OTP delivery
 * channel). Written by the portal from the mobile app and read by the import
 * child when selecting the OTP prompter. `OTP_SETTINGS_PATH` overrides the
 * default so both processes point at one file on a shared volume.
 */

const DEFAULT_OTP_SETTINGS_PATH = '/app/data/otp-settings.json';

/**
 * Resolves the OTP-settings file path from `OTP_SETTINGS_PATH`, falling back to
 * the default Docker data path when the env var is unset or blank.
 * @returns The absolute OTP-settings file path.
 */
export default function resolveOtpSettingsPath(): string {
  const override = process.env.OTP_SETTINGS_PATH?.trim();
  return override !== undefined && override.length > 0 ? override : DEFAULT_OTP_SETTINGS_PATH;
}
