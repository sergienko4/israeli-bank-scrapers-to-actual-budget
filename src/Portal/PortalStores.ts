/**
 * The runtime stores the portal serves, handed to the routes as factories.
 *
 * <p>The portal builds this once at startup and passes it to route
 * registration, so no route handler builds a store itself. A handler calls
 * its factory once per request, so the store's path is still resolved when
 * the request arrives.
 */

import type OtpSettingsStore from '../Services/TwoFactor/OtpSettingsStore.js';
import openOtpSettingsStore from '../Services/TwoFactor/OtpSettingsStoreWiring.js';

/** One factory per runtime store the portal reads or writes. */
export interface IPortalStores {
  /** Opens the OTP delivery-channel store. */
  readonly otpSettings: () => OtpSettingsStore;
}

/**
 * Builds the factories for the stores on the real filesystem.
 * @returns The portal's store factories.
 */
export default function openPortalStores(): IPortalStores {
  const stores: IPortalStores = { otpSettings: openOtpSettingsStore };
  return stores;
}
