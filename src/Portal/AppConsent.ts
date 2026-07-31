/**
 * The approval step between a signed-in browser and a minted authorization
 * code.
 *
 * Without it, opening a crafted `/auth/app/authorize` link in a browser that is
 * already signed in mints a code silently and hands it to whatever app claims
 * the redirect scheme. PKCE does not help here: an attacker who wrote the link
 * chose the challenge, so they hold the verifier. Requiring a click on a page
 * the portal itself issued means an authorization the user never started does
 * not become a code on its own.
 *
 * This narrows the window rather than closing it â€” a user who approves anyway
 * has still approved. Only a verified HTTPS redirect target would close it, and
 * the portal's address belongs to the operator, not to us.
 *
 * The page itself is a static asset. Building it here would mean assembling
 * HTML around a device name the caller chose, and hand-written escaping is the
 * kind of thing that is wrong once and then wrong forever; the asset writes
 * that name with `textContent` instead.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** How long an approval stays usable, in milliseconds. */
export const CONSENT_TTL_MS = 5 * 60 * 1000;

/** The static page that asks the operator to approve. */
export const CONSENT_PATH = '/approve.html';

/** The fields an approval is bound to, so it cannot be moved to another request. */
export interface IConsentSubject {
  redirectUri: string;
  challenge: string;
  state: string;
  deviceName: string;
}

/**
 * Renders the subject as one unambiguous string.
 *
 * The separator cannot appear in any field: a redirect URI carries no
 * whitespace, the challenge and state are restricted character sets, and the
 * device name has its control characters stripped before it arrives.
 * @param subject - The authorization being approved.
 * @returns The string the signature covers.
 */
function canonical(subject: IConsentSubject): string {
  return [subject.redirectUri, subject.challenge, subject.state, subject.deviceName].join('\n');
}

/**
 * Computes the signature for one subject and expiry.
 * @param subject - The authorization being approved.
 * @param expires - Epoch milliseconds after which the approval is refused.
 * @param secret - The portal session secret.
 * @returns Lowercase hex HMAC.
 */
function digest(subject: IConsentSubject, expires: number, secret: string): string {
  const body = canonical(subject);
  const hmac = createHmac('sha256', secret);
  return hmac.update(`${body}\n${String(expires)}`).digest('hex');
}

/** What {@link verifyConsent} needs to judge one presented token. */
export interface IConsentCheck {
  token: string;
  subject: IConsentSubject;
  secret: string;
  now?: number;
}

/**
 * Issues an approval for one authorization request.
 * @param subject - The authorization being approved.
 * @param secret - The portal session secret.
 * @param now - Current epoch milliseconds, injectable for tests.
 * @returns The token to carry back on the approving request.
 */
export function mintConsent(
  subject: IConsentSubject, secret: string, now: number = Date.now(),
): string {
  const expires = now + CONSENT_TTL_MS;
  const signature = digest(subject, expires, secret);
  return `${String(expires)}.${signature}`;
}

/**
 * Whether a token approves exactly this authorization and has not expired.
 * @param check - The presented token, the request it must match, and the secret.
 * @returns True when the token was issued here, for this request, and is live.
 */
export function verifyConsent(check: IConsentCheck): boolean {
  const { token, subject, secret } = check;
  const now = check.now ?? Date.now();
  const separator = token.indexOf('.');
  if (separator < 0) return false;
  const stamp = token.slice(0, separator);
  const expires = Number(stamp);
  if (!Number.isInteger(expires) || expires <= now) return false;
  const signature = digest(subject, expires, secret);
  const expected = Buffer.from(signature);
  const presented = token.slice(separator + 1);
  const actual = Buffer.from(presented);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
