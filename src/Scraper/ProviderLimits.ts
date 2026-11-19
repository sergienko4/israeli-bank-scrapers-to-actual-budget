/**
 * The provider's public-boundary caps for the opaque values the importer keeps.
 *
 * <p>Scraper 10.1.0 validates options and credentials before any bank request
 * and returns `GENERIC` when a value is too long. `otpLongTermToken` and
 * `persistentAuthState` are stored by the importer and re-sent unchanged, so a
 * cap that is too high would send a value the provider rejects on every run.
 * The values mirror the provider's `BoundaryValidation`; the drift test in
 * `tests/scraper/ProviderLimits.test.ts` fails when they move.
 */

/** Longest `otpLongTermToken` the provider accepts, in characters. */
export const MAX_OTP_LONG_TERM_TOKEN_CHARS = 16_384;

/** Longest `persistentAuthState` the provider accepts, in characters. */
export const MAX_PERSISTENT_AUTH_STATE_CHARS = 32_768;

/**
 * Tells whether a value exceeds a cap the provider enforces.
 * @param value - Value about to be sent to the provider.
 * @param cap - Provider's maximum length, in characters.
 * @returns True when the provider would reject the value before any request.
 */
function exceedsCap(value: string, cap: number): boolean {
  return value.length > cap;
}

/**
 * Tells whether a long-term token is too long for the provider.
 * @param token - Token about to be sent as `otpLongTermToken`.
 * @returns True when the provider would reject it before any request.
 */
export function isOversizedOtpToken(token: string): boolean {
  return exceedsCap(token, MAX_OTP_LONG_TERM_TOKEN_CHARS);
}

/**
 * Tells whether a stored device state is too long for the provider.
 * @param state - State about to be sent as `persistentAuthState`.
 * @returns True when the provider would reject it before any request.
 */
export function isOversizedDeviceState(state: string): boolean {
  return exceedsCap(state, MAX_PERSISTENT_AUTH_STATE_CHARS);
}
