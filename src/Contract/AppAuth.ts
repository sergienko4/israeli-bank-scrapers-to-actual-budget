/**
 * Contract for the mobile app's authentication endpoints: the code-for-token
 * exchange, refresh-token rotation, revocation, and session listing.
 *
 * These routes keep their hand-written body parsing. They answer 503 when app
 * sign-in is switched off, and that answer is decided before the body is
 * looked at; schema validation runs earlier still, so declaring request bodies
 * here would turn a disabled-importer reply from 503 into 400. They take their
 * response shapes and static types from this contract instead.
 */

import { type Static, Type } from '@sinclair/typebox';

/** What a successful exchange or rotation hands back to the app. */
export const GRANTED_TOKENS = Type.Object({
  accessToken: Type.String({ description: 'Short-lived bearer token for the portal API.' }),
  refreshToken: Type.String({ description: 'Single-use token that rotates on every refresh.' }),
  expiresIn: Type.Number({ description: 'Access-token lifetime, in seconds.' }),
  tokenType: Type.Literal('Bearer'),
  sessionId: Type.String({ description: 'Id of the session this grant belongs to.' }),
});

/** One signed-in device, as shown to the user. */
export const APP_SESSION_VIEW = Type.Object({
  id: Type.String({ description: 'Session id, used to sign this device out.' }),
  deviceName: Type.String({ description: 'Name the device reported at sign-in.' }),
  issuedAt: Type.Number({ description: 'When the session began, epoch milliseconds.' }),
  lastUsedAt: Type.Number({ description: 'Last refresh, epoch milliseconds.' }),
  expiresAt: Type.Number({ description: 'When the refresh token dies, epoch milliseconds.' }),
  current: Type.Boolean({ description: 'Whether this is the calling device.' }),
});

/** The GET /api/app/sessions 200 body. */
export const APP_SESSION_LIST = Type.Array(APP_SESSION_VIEW, {
  description: 'Every live app session, newest last.',
});

/** Path parameters for signing one device out. */
export const APP_SESSION_PARAMS = Type.Object({
  id: Type.String({ minLength: 1, description: 'Session id to revoke.' }),
});

/** What a successful exchange or rotation hands back to the app. */
export type GrantedTokens = Static<typeof GRANTED_TOKENS>;

/** One signed-in device, as shown to the user. */
export type AppSessionView = Static<typeof APP_SESSION_VIEW>;

/** The GET /api/app/sessions 200 body. */
export type AppSessionList = Static<typeof APP_SESSION_LIST>;

/** Path parameters for signing one device out. */
export type AppSessionParams = Static<typeof APP_SESSION_PARAMS>;
