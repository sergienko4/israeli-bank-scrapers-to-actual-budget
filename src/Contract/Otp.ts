/**
 * Contract for the OTP routes — the pending-request poll, the code submission,
 * and the delivery-channel settings.
 *
 * The code pattern lives here rather than in the handler so the server rejects
 * a malformed code before any handler runs, and so a client can apply the same
 * rule before spending a network round trip on it.
 */

import { type Static, Type } from '@sinclair/typebox';

/** Where the importer asks the user for a one-time code. */
export const OTP_CHANNEL = Type.Union([Type.Literal('telegram'), Type.Literal('app')], {
  description: 'OTP delivery channel: Telegram (default) or the mobile app.',
});

/** The OTP delivery settings. */
export const OTP_SETTINGS = Type.Object({ channel: OTP_CHANNEL });

/** A request awaiting a code. Never carries the code itself. */
export const PENDING_OTP_REQUEST = Type.Object({
  id: Type.String({ description: 'Opaque id the client submits its code against.' }),
  bankId: Type.String({ description: 'Bank the code is for, shown to the user.' }),
  createdAt: Type.Number({ description: 'Creation time, epoch milliseconds.' }),
  deadline: Type.Number({ description: 'Expiry time, epoch milliseconds.' }),
});

/** The GET /api/otp/pending 200 body. */
export const PENDING_OTP_BODY = Type.Object({
  requests: Type.Array(PENDING_OTP_REQUEST, {
    description: 'Live requests awaiting a code. Empty when none are outstanding.',
  }),
});

/** Path parameters for the submit route. */
export const OTP_SUBMIT_PARAMS = Type.Object({
  id: Type.String({ minLength: 1, description: 'Id of the request being answered.' }),
});

/** The POST /api/otp/:id request body. */
export const OTP_SUBMIT_BODY = Type.Object({
  code: Type.String({
    pattern: String.raw`^\d{4,8}$`,
    description: 'The 4-8 digit code the user entered. Never logged.',
  }),
});

/** Where the importer asks the user for a one-time code. */
export type OtpChannel = Static<typeof OTP_CHANNEL>;

/** The OTP delivery settings. */
export type OtpSettings = Static<typeof OTP_SETTINGS>;

/** A request awaiting a code. */
export type PendingOtpRequest = Static<typeof PENDING_OTP_REQUEST>;

/** The GET /api/otp/pending 200 body. */
export type PendingOtpBody = Static<typeof PENDING_OTP_BODY>;

/** Path parameters for the submit route. */
export type OtpSubmitParams = Static<typeof OTP_SUBMIT_PARAMS>;

/** The POST /api/otp/:id request body. */
export type OtpSubmitBody = Static<typeof OTP_SUBMIT_BODY>;
