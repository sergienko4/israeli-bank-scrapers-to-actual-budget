/**
 * OTP-request store wiring: the store at `OTP_REQUESTS_PATH` on the real
 * filesystem. The portal and the importer both open it through here, so both
 * resolve the path the same way.
 */

import createNodeFileSystem from '../../Storage/NodeFileSystem.js';
import resolveOtpRequestsPath from './OtpRequestPath.js';
import OtpRequestStore from './OtpRequestStore.js';

/**
 * Opens the OTP-request store.
 *
 * Opening it touches no file.
 * @returns The store at `OTP_REQUESTS_PATH`.
 */
export default function openOtpRequestStore(): OtpRequestStore {
  return new OtpRequestStore(createNodeFileSystem(), resolveOtpRequestsPath());
}
