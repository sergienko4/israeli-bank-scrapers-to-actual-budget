/**
 * The runtime stores an import sweeps when it starts: the four JSON files on
 * the data volume it can write. Every import runs in its own process, so
 * sweeping at start covers every run that can leave a staged file behind.
 */

import type { ILogger } from '../Logger/ILogger.js';
import openAuditLog from '../Services/AuditLogWiring.js';
import openDeviceTokenStore from '../Services/Notifications/DeviceTokenStoreWiring.js';
import type { ISweepTarget } from '../Services/StoreSweep.js';
import sweepStores from '../Services/StoreSweep.js';
import openOtpRequestStore from '../Services/TwoFactor/OtpRequestStoreWiring.js';
import openOtpSettingsStore from '../Services/TwoFactor/OtpSettingsStoreWiring.js';

/** The stores an import can write, each opened at its configured path. */
const IMPORT_STORES: readonly ISweepTarget[] = [
  { label: 'audit log', open: openAuditLog },
  { label: 'OTP settings', open: openOtpSettingsStore },
  { label: 'device tokens', open: openDeviceTokenStore },
  { label: 'OTP requests', open: openOtpRequestStore },
];

/**
 * Sweeps the staging leftovers of the stores an import can write.
 * @param logger - Where reports and warnings go.
 * @returns How many stores were swept without a warning.
 */
export default function sweepImportStores(logger: ILogger): number {
  return sweepStores(IMPORT_STORES, logger);
}
