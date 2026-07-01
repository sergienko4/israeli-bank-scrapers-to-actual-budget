/**
 * Auth policy: given the configured PortalAuthMode, decides whether a session
 * satisfies every required factor. `both` needs Google AND password; the
 * single modes need just their factor. OCP map avoids an if/else chain.
 */

import type { PortalAuthMode } from '../Types/Index.js';
import type { ISessionPayload } from './PortalSession.js';

/** Predicate: does the session satisfy a given auth mode? */
type ModeCheck = (s: ISessionPayload) => boolean;

/**
 * Reports whether the password factor is present.
 * @param s - Decoded session payload.
 * @returns True when the password factor is satisfied.
 */
function passwordSatisfied(s: ISessionPayload): boolean {
  return s.password;
}

/**
 * Reports whether the Google factor is present.
 * @param s - Decoded session payload.
 * @returns True when the Google factor is satisfied.
 */
function googleSatisfied(s: ISessionPayload): boolean {
  return s.google;
}

/**
 * Reports whether both Google and password factors are present.
 * @param s - Decoded session payload.
 * @returns True when both factors are satisfied.
 */
function bothSatisfied(s: ISessionPayload): boolean {
  return s.google && s.password;
}

/** Mode → satisfied-predicate map (open for new modes, closed to edits). */
const SATISFIED: Record<PortalAuthMode, ModeCheck> = {
  password: passwordSatisfied,
  google: googleSatisfied,
  both: bothSatisfied,
};

/**
 * Reports whether a session fully satisfies the configured auth mode.
 * @param session - Decoded, valid session payload.
 * @param mode - Configured portal auth mode.
 * @returns True when every required factor is present.
 */
export function isAuthorized(session: ISessionPayload, mode: PortalAuthMode): boolean {
  return SATISFIED[mode](session);
}

/**
 * Checks an email against the allow-list (empty list = allow none).
 * @param email - Verified Google email.
 * @param allowed - Allow-listed emails (case-insensitive).
 * @returns True when the email is permitted.
 */
export function isEmailAllowed(email: string, allowed: string[]): boolean {
  const target = email.trim().toLowerCase();
  return allowed.some(candidate => candidate.trim().toLowerCase() === target);
}
