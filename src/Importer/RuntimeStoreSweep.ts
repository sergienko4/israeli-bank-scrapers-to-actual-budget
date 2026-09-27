/**
 * The runtime stores an import sweeps when it starts: the JSON files on the
 * data volume it writes. Every import runs in its own process, so sweeping at
 * start covers every run that can leave a staged file behind.
 *
 * <p>Only the writer sweeps. The OTP channel and the device tokens are
 * written by the portal alone, which sweeps them when it starts; the import
 * only reads them, and a leftover there may belong to a portal still running.
 * The app refresh tokens are the portal's alone: the import never opens them.
 */

import type { ILogger } from '../Logger/ILogger.js';
import openAuditLog from '../Services/AuditLogWiring.js';
import type { ISweepTarget } from '../Services/StoreSweep.js';
import sweepStores from '../Services/StoreSweep.js';
import openOtpRequestStore from '../Services/TwoFactor/OtpRequestStoreWiring.js';

/** The stores an import writes, each opened at its configured path. */
const IMPORT_STORES: readonly ISweepTarget[] = [
  { label: 'audit log', open: openAuditLog },
  { label: 'OTP requests', open: openOtpRequestStore },
];

/**
 * Sweeps the staging leftovers of the stores an import writes.
 * @param logger - Where reports and warnings go.
 * @returns How many stores were swept without a warning.
 */
export default function sweepImportStores(logger: ILogger): number {
  return sweepStores(IMPORT_STORES, logger);
}
