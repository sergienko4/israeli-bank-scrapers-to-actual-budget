/**
 * Hands the credential values a config holds to the logger's value masker.
 *
 * <p>A bank can quote a credential back with no key in front of it, which the
 * key rule in `redactSecrets` cannot see. The config is where the importer
 * learns its credentials, so each place a config enters the process calls
 * {@link registerConfigSecrets}; from then on every output masks those values
 * wherever they appear. The secret fields are the manifest's, read through
 * {@link splitSecrets}, so this list cannot drift from what the portal masks
 * and what credentials.json holds.
 */

import { registerSecretValues } from '../Logger/SecretValues.js';
import type { IImporterConfig } from '../Types/Index.js';
import { isSuccess } from '../Types/Index.js';
import normalisePhoneNumber from '../Utils/PhoneNumberNormaliser.js';
import splitSecrets from './SecretSplitter.js';

/** The config key whose value is a phone number, sent in several forms. */
const PHONE_KEY = 'phoneNumber';

/** The country code that starts a canonical Israeli phone number. */
const COUNTRY_CODE = '972';

/** Mutable record alias for walking the secrets half of a config. */
type Branch = Record<string, unknown>;

/**
 * Whether a value is a plain object to walk into.
 * @param value - Candidate value.
 * @returns True for plain objects; false for leaves, arrays and null.
 */
function isBranch(value: unknown): value is Branch {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Lists the forms a phone number takes on the wire: as written, canonical,
 * and the national digits every provider form contains.
 * @param raw - The phone number as the config holds it.
 * @returns Each form to mask; only the raw value when it is not Israeli.
 */
function phoneForms(raw: string): string[] {
  const canonical = normalisePhoneNumber(raw);
  if (!isSuccess(canonical)) return [raw];
  const national = canonical.data.slice(COUNTRY_CODE.length);
  return [raw, canonical.data, national];
}

/**
 * Lists the forms one secret leaf can take in an output.
 * @param key - The config key the leaf sits under.
 * @param value - The secret leaf, a string or a number.
 * @returns The forms to mask.
 */
function leafForms(key: string, value: unknown): string[] {
  const text = String(value);
  if (key === PHONE_KEY) return phoneForms(text);
  return [text];
}

/**
 * Collects every secret value under a branch of the secrets half.
 * @param branch - A branch that holds only secret leaves and sub-branches.
 * @param found - The values collected so far; extended in place.
 * @returns The same list, with this branch's values added.
 */
function collectValues(branch: Branch, found: string[]): string[] {
  for (const [key, value] of Object.entries(branch)) {
    if (isBranch(value)) collectValues(value, found);
    else {
      const forms = leafForms(key, value);
      found.push(...forms);
    }
  }
  return found;
}

/**
 * Registers every secret value a config holds with the value masker, so no
 * output can show one even when a bank quotes it back with no key.
 * @param config - A config just read or about to be written.
 * @returns How many forms of secret values the process now masks.
 */
export default function registerConfigSecrets(config: IImporterConfig): number {
  if (!isBranch(config)) return registerSecretValues([]);
  const { secrets } = splitSecrets(config);
  const values = collectValues(secrets, []);
  return registerSecretValues(values);
}
