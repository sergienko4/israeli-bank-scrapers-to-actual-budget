/**
 * Resolves the device-token registry path shared by the portal (writer) and the
 * importer's Expo push notifier (reader). `DEVICE_TOKENS_PATH` overrides the
 * default so both processes can point at one file on a shared volume.
 */

const DEFAULT_DEVICE_TOKENS_PATH = '/app/data/devices.json';

/**
 * Resolves the device-tokens file path from `DEVICE_TOKENS_PATH`, falling back to
 * the default Docker data path when the env var is unset or blank.
 * @returns The absolute device-tokens file path.
 */
export default function resolveDeviceTokensPath(): string {
  const override = process.env.DEVICE_TOKENS_PATH?.trim();
  return override !== undefined && override.length > 0 ? override : DEFAULT_DEVICE_TOKENS_PATH;
}
