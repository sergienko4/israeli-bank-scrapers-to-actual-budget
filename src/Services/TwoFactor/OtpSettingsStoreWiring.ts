/**
 * OTP-settings store wiring: the store at `OTP_SETTINGS_PATH` on the real
 * filesystem. The portal and the importer both open it through here, so both
 * resolve the path the same way.
 */

import createNodeFileSystem from '../../Storage/NodeFileSystem.js';
import resolveOtpSettingsPath from './OtpSettingsPath.js';
import OtpSettingsStore from './OtpSettingsStore.js';

/**
 * Opens the OTP-settings store.
 *
 * Opening it touches no file; a relative `OTP_SETTINGS_PATH` throws here.
 * @returns The store at `OTP_SETTINGS_PATH`.
 */
export default function openOtpSettingsStore(): OtpSettingsStore {
  return new OtpSettingsStore(createNodeFileSystem(), resolveOtpSettingsPath());
}
