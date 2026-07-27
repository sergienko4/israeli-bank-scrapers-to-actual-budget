/**
 * Resolves the app-OTP request file path shared by the portal (writer of
 * submitted codes) and the import child process (creator + reader). Mirrors the
 * device-token registry: `OTP_REQUESTS_PATH` overrides the default so both
 * processes point at one file on a shared volume.
 */

const DEFAULT_OTP_REQUESTS_PATH = '/app/data/otp-requests.json';

/**
 * Resolves the OTP-requests file path from `OTP_REQUESTS_PATH`, falling back to
 * the default Docker data path when the env var is unset or blank.
 * @returns The absolute OTP-requests file path.
 */
export default function resolveOtpRequestsPath(): string {
  const override = process.env.OTP_REQUESTS_PATH?.trim();
  return override !== undefined && override.length > 0 ? override : DEFAULT_OTP_REQUESTS_PATH;
}
