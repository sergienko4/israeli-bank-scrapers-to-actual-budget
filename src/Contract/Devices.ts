/**
 * Contract for the device-registration routes, which record the Expo push
 * tokens the importer sends OTP prompts to.
 *
 * The token pattern lives here so an unusable token is refused before it can
 * reach the store and sit there failing silently at delivery time.
 */

import { type Static, Type } from '@sinclair/typebox';

/** The POST/DELETE /api/devices request body. */
export const DEVICE_BODY = Type.Object({
  token: Type.String({
    pattern: '^Expo(?:nent)?PushToken\\[[^\\]]+\\]$',
    description: 'Expo push token, e.g. ExponentPushToken[xxxxxxxx].',
  }),
});

/** The POST/DELETE /api/devices request body. */
export type DeviceBody = Static<typeof DEVICE_BODY>;
