/**
 * Device-token store wiring: the store at `DEVICE_TOKENS_PATH` on the real
 * filesystem. The portal and the importer both open it through here, so both
 * resolve the path the same way.
 */

import createNodeFileSystem from '../../Storage/NodeFileSystem.js';
import resolveDeviceTokensPath from './DeviceTokenPath.js';
import DeviceTokenStore from './DeviceTokenStore.js';

/**
 * Opens the device-token store.
 *
 * Opening it touches no file.
 * @returns The store at `DEVICE_TOKENS_PATH`.
 */
export default function openDeviceTokenStore(): DeviceTokenStore {
  return new DeviceTokenStore(createNodeFileSystem(), resolveDeviceTokensPath());
}
