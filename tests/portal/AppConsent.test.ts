/**
 * Proves the approval step is what turns an authorized browser into a code.
 *
 * The point of the step is that a link alone is not enough: the token has to
 * have been issued by this portal, for this exact request, recently. Each test
 * here removes one of those and expects a refusal.
 */
import { describe, expect, it } from 'vitest';

import type { IConsentSubject } from '../../src/Portal/AppConsent.js';
import { CONSENT_TTL_MS, mintConsent, verifyConsent } from '../../src/Portal/AppConsent.js';

const SECRET = 'portal-test-secret-0123456789';
const NOW = 1_700_000_000_000;

const SUBJECT: IConsentSubject = {
  redirectUri: 'bankimporter://auth',
  challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  state: 'state-123',
  deviceName: 'Pixel 8',
};

/**
 * Builds a check for the given token against the standard subject.
 * @param token - The token to present.
 * @param now - The moment to judge it at.
 * @returns Arguments for {@link verifyConsent}.
 */
function check(token: string, now = NOW): Parameters<typeof verifyConsent>[0] {
  return { token, subject: SUBJECT, secret: SECRET, now };
}

describe('mintConsent and verifyConsent', () => {
  it('accepts the token it just issued for this request', () => {
    const token = mintConsent(SUBJECT, SECRET, NOW);
    expect(verifyConsent(check(token))).toBe(true);
  });

  it('refuses a token that was never issued', () => {
    expect(verifyConsent(check(`${String(NOW + 1000)}.not-a-signature`))).toBe(false);
  });

  it('refuses a value with no expiry at all', () => {
    expect(verifyConsent(check('just-a-signature'))).toBe(false);
  });

  it('refuses a token whose expiry was pushed out by hand', () => {
    const token = mintConsent(SUBJECT, SECRET, NOW);
    const signature = token.slice(token.indexOf('.'));
    expect(verifyConsent(check(`${String(NOW + CONSENT_TTL_MS * 10)}${signature}`))).toBe(false);
  });

  it('refuses its own token once the window has passed', () => {
    const token = mintConsent(SUBJECT, SECRET, NOW);
    expect(verifyConsent(check(token, NOW + CONSENT_TTL_MS + 1))).toBe(false);
  });

  it('refuses a token signed with another secret', () => {
    const token = mintConsent(SUBJECT, 'a-different-portal-secret', NOW);
    expect(verifyConsent(check(token))).toBe(false);
  });

  it.each([
    ['redirectUri', { redirectUri: 'bankimporter://elsewhere' }],
    ['challenge', { challenge: 'sTOTALLYdifferentCHALLENGEvalue0123456789abc' }],
    ['state', { state: 'another-state' }],
    ['deviceName', { deviceName: 'Someone else phone' }],
  ])('refuses a token moved to a request with a different %s', (_field, override) => {
    const token = mintConsent({ ...SUBJECT, ...override }, SECRET, NOW);
    expect(verifyConsent(check(token))).toBe(false);
  });
});
