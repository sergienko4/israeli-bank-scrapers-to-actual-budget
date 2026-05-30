/**
 * Masks Israeli phone numbers for log output to comply with the
 * project PII logging guidelines. Returns `972***LAST3` for inputs
 * that normalise to a canonical Israeli number, or `<masked>` for
 * empty / unparseable inputs.
 */

import normalisePhoneNumber from '../Scraper/PhoneNumberNormaliser.js';

const MASKED = '<masked>';
const VISIBLE_TRAILING = 3;

/**
 * Masks a phone number for log output. Preserves the `972` country
 * code and the last 3 digits so users can self-identify their record
 * without exposing the full PII.
 * @param raw - Any string; may be malformed or empty.
 * @returns `972***LAST3` when `raw` parses to a canonical Israeli
 *          number; `<masked>` otherwise. Never throws.
 */
export default function maskPhone(raw: string): string {
  const normalised = normalisePhoneNumber(raw);
  if (!normalised.success) return MASKED;
  const last = normalised.data.slice(-VISIBLE_TRAILING);
  return `972***${last}`;
}
