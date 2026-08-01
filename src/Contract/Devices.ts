/**
 * Contract for the device-registration routes, which record the Expo push
 * tokens the importer sends OTP prompts to.
 *
 * The token pattern lives here so an unusable token is refused before it can
 * reach the store and sit there failing silently at delivery time.
 */

import { type Static, Type } from '@sinclair/typebox';

/**
 * The POST/DELETE /api/devices request body.
 *
 * The token body excludes line breaks as well as the closing bracket. `$` in a
 * JavaScript pattern already means end of input, so a trailing newline is
 * refused without help — but `[^\]]` alone would accept one in the middle of
 * the token, which no real Expo token contains.
 */
export const DEVICE_BODY = Type.Object({
  token: Type.String({
    pattern: String.raw`^Expo(?:nent)?PushToken\[[^\]\r\n]+\]$`,
    description: 'Expo push token, e.g. ExponentPushToken[xxxxxxxx].',
  }),
});

/** The POST/DELETE /api/devices request body. */
export type DeviceBody = Static<typeof DEVICE_BODY>;
