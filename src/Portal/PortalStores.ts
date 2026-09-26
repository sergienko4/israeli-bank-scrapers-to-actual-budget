/**
 * The runtime stores the portal serves, handed to the routes as factories.
 *
 * <p>The portal builds this once at startup and passes it to route
 * registration, so no route handler builds a store itself. A handler calls
 * its factory once per request, so the store's path is still resolved when
 * the request arrives.
 */

import type { ILogger } from '../Logger/ILogger.js';
import type { AuditLogService } from '../Services/AuditLogService.js';
import openAuditLog from '../Services/AuditLogWiring.js';
import type DeviceTokenStore from '../Services/Notifications/DeviceTokenStore.js';
import openDeviceTokenStore from '../Services/Notifications/DeviceTokenStoreWiring.js';
import sweepStores from '../Services/StoreSweep.js';
import type OtpRequestStore from '../Services/TwoFactor/OtpRequestStore.js';
import openOtpRequestStore from '../Services/TwoFactor/OtpRequestStoreWiring.js';
import type OtpSettingsStore from '../Services/TwoFactor/OtpSettingsStore.js';
import openOtpSettingsStore from '../Services/TwoFactor/OtpSettingsStoreWiring.js';
import type { AppTokenStore } from './AppTokenStore.js';
import openAppTokenStore from './AppTokenStoreWiring.js';

/** One factory per runtime store the portal reads or writes. */
export interface IPortalStores {
  /** Opens the mobile app's refresh-token store. */
  readonly appTokens: () => AppTokenStore;
  /** Opens the import-run history the status route reads. */
  readonly auditLog: () => AuditLogService;
  /** Opens the mobile app's device-token store. */
  readonly devices: () => DeviceTokenStore;
  /** Opens the pending app-OTP request store. */
  readonly otpRequests: () => OtpRequestStore;
  /** Opens the OTP delivery-channel store. */
  readonly otpSettings: () => OtpSettingsStore;
}

/**
 * Builds the factories for the stores on the real filesystem.
 * @returns The portal's store factories.
 */
export default function openPortalStores(): IPortalStores {
  const stores: IPortalStores = {
    appTokens: openAppTokenStore,
    auditLog: openAuditLog,
    devices: openDeviceTokenStore,
    otpRequests: openOtpRequestStore,
    otpSettings: openOtpSettingsStore,
  };
  return stores;
}

/**
 * Sweeps the staging leftovers of the stores the portal writes. The audit log
 * is left to the importer, which is the only process that writes it.
 * @param stores - The portal's store factories.
 * @param logger - Where reports and warnings go.
 * @returns How many stores were swept without a warning.
 */
export function sweepPortalStores(stores: IPortalStores, logger: ILogger): number {
  return sweepStores([
    { label: 'OTP settings', open: stores.otpSettings },
    { label: 'device tokens', open: stores.devices },
    { label: 'OTP requests', open: stores.otpRequests },
    { label: 'app tokens', open: stores.appTokens },
  ], logger);
}
