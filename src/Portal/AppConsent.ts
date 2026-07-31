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
 * This narrows the window rather than closing it — a user who approves anyway
 * has still approved. Only a verified HTTPS redirect target would close it, and
 * the portal's address belongs to the operator, not to us.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** How long an approval stays usable, in milliseconds. */
export const CONSENT_TTL_MS = 5 * 60 * 1000;

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

/**
 * Escapes the characters that would let a value break out of the page.
 * @param value - Untrusted text destined for HTML.
 * @returns The text, safe to interpolate.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The approval page's styles, kept out of the builder so it stays readable. */
const CONSENT_STYLE = `body { font-family: system-ui, sans-serif; margin: 0; display: grid;
  place-items: center; min-height: 100vh; background: #10131a; color: #e6e9ef; }
main { max-width: 22rem; padding: 2rem; text-align: center; }
h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
p { color: #9aa3b2; line-height: 1.5; }
strong { color: #e6e9ef; }
a#approve { display: block; margin-top: 1.5rem; padding: .75rem 1rem; border-radius: .5rem;
  background: #3b82f6; color: #fff; text-decoration: none; font-weight: 600; }`;

/** The head of the approval page, which carries no untrusted value. */
const CONSENT_HEAD = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Approve sign-in</title>
<style>${CONSENT_STYLE}</style>
</head>`;

/**
 * Builds the page that asks the operator to approve one sign-in.
 *
 * The device name is the only untrusted value on the page, and it arrives from
 * a query parameter, so it is escaped rather than trusted.
 * @param subject - The authorization being approved.
 * @param target - The URL the approve button navigates to.
 * @returns A complete HTML document.
 */
export function consentPage(subject: IConsentSubject, target: string): string {
  const device = escapeHtml(subject.deviceName);
  const href = escapeHtml(target);
  return `${CONSENT_HEAD}
<body>
<main>
<h1>Approve sign-in</h1>
<p><strong>${device}</strong> is asking to sign in to this importer.</p>
<p>Approve only if you just started this on that device.</p>
<a id="approve" href="${href}">Approve</a>
</main>
</body>
</html>`;
}
