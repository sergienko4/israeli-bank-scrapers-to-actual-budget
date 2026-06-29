import { describe, expect, it } from 'vitest';

import type { PortalAuthMode } from '../../src/Types/Index.js';
import { isAuthorized, isEmailAllowed } from '../../src/Portal/PortalAuthPolicy.js';
import type { ISessionPayload } from '../../src/Portal/PortalSession.js';

/**
 * Builds a session payload with explicit factor flags.
 * @param google - Google factor satisfied.
 * @param password - Password factor satisfied.
 * @returns ISessionPayload fixture with a far-future expiry.
 */
function session(google: boolean, password: boolean): ISessionPayload {
  return { google, password, expires: Date.now() + 1000 };
}

describe('PortalAuthPolicy', () => {
  describe('isAuthorized', () => {
    const cases: { mode: PortalAuthMode; google: boolean; password: boolean; ok: boolean }[] = [
      { mode: 'password', google: false, password: true, ok: true },
      { mode: 'password', google: false, password: false, ok: false },
      { mode: 'google', google: true, password: false, ok: true },
      { mode: 'google', google: false, password: false, ok: false },
      { mode: 'both', google: true, password: true, ok: true },
      { mode: 'both', google: true, password: false, ok: false },
      { mode: 'both', google: false, password: true, ok: false },
    ];
    it.each(cases)('mode=$mode g=$google p=$password -> $ok', ({ mode, google, password, ok }) => {
      expect(isAuthorized(session(google, password), mode)).toBe(ok);
    });
  });

  describe('isEmailAllowed', () => {
    it('matches case-insensitively', () => {
      expect(isEmailAllowed('User@Example.com', ['user@example.com'])).toBe(true);
    });

    it('rejects emails not on the list', () => {
      expect(isEmailAllowed('intruder@example.com', ['user@example.com'])).toBe(false);
    });

    it('allows none when the list is empty', () => {
      expect(isEmailAllowed('user@example.com', [])).toBe(false);
    });
  });
});
