/**
 * Coerces user-supplied Israeli phone numbers into the canonical
 * digits-only wire form (`972` + 9 digits) required by the upstream
 * israeli-bank-scrapers API-direct flows (PayBox, Pepper, OneZero).
 *
 * Upstream `validateInternationalDigits` rejects "+", "-", spaces, then
 * silently ships the RAW input downstream — bypassing the bank-specific
 * wire-format step (international-dash / international-flat /
 * international-plus). PayBox's `/phoneValidate` then returns HTTP 400;
 * Pepper's auth response omits the SMS channel from the method list,
 * producing the "envelope selector miss: smsAssertionId" error.
 * Normalising at the credentials boundary avoids both failures.
 */

import type { Procedure } from '../Types/Index.js';
import { fail, succeed } from '../Types/Index.js';

const STRIP_RE = /[+\-\s]/g;
const ISRAELI_CANONICAL_RE = /^972\d{9}$/;
const ISRAELI_LOCAL_LEN = 10;

/**
 * Strips formatting characters and coerces Israeli local form to canonical.
 * @param raw - Raw phone string from config or env.
 * @returns Stripped digits-only string ready for canonical validation.
 */
export function stripPhoneFormatting(raw: string): string {
  if (typeof raw !== 'string') return '';
  const stripped = raw.replaceAll(STRIP_RE, '');
  if (stripped.length === ISRAELI_LOCAL_LEN && stripped.startsWith('0')) {
    return `972${stripped.slice(1)}`;
  }
  return stripped;
}

/**
 * Normalises an Israeli phone number to the canonical `972XXXXXXXXX` form.
 * Accepts "+972...", "972...", "972-XX-XXXXXXX", "972 XX XXXXXXX",
 * "+972 XX-XXX-XXXX", and Israeli local "0XXXXXXXXX". Returns fail for
 * empty input, non-Israeli prefixes, or any input whose stripped digits
 * don't match `972` + 9 digits.
 * @param raw - Raw phone string as supplied by config.json or env.
 * @returns Procedure with the canonical digits-only string on success,
 *          or fail with a human-readable reason on schema mismatch.
 */
export default function normalisePhoneNumber(raw: string): Procedure<string> {
  if (typeof raw !== 'string' || raw.length === 0) {
    return fail('Phone must be Israeli digits-only (972XXXXXXXXX or 0XXXXXXXXX)');
  }
  const candidate = stripPhoneFormatting(raw);
  if (!ISRAELI_CANONICAL_RE.test(candidate)) {
    return fail(
      'Phone must be Israeli digits-only (972XXXXXXXXX or 0XXXXXXXXX), ' +
      `got ${String(raw.length)} chars`
    );
  }
  return succeed(candidate);
}
