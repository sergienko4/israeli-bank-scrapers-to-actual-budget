/**
 * Which login a long-term token belongs to, as a one-way fingerprint.
 *
 * <p>A Pepper or PayBox token logs in by itself — the provider skips every
 * login step on the warm path — so a token replayed under another login's
 * config imports that other account. Binding each stored token to the login
 * that minted it lets the importer refuse such a replay.
 *
 * <p>The identity is what the provider logs in with: the upstream scraper's
 * declared `loginFields` minus the password, each in the form the provider
 * receives it. So OneZero is keyed by its email and Pepper and PayBox by
 * their phone, and the bank is part of the input, so one phone at two banks
 * gives two logins. The password never enters the hash.
 */

import { createHash } from 'node:crypto';

import { SCRAPERS } from '@sergienko4/israeli-bank-scrapers';

import type { IBankConfig, Procedure } from '../../Types/Index.js';
import { fail, succeed } from '../../Types/Index.js';
import { toProviderPhone } from '../../Utils/PhoneNumberNormaliser.js';

/** The login field that is a secret, not an identity. */
const SECRET_LOGIN_FIELD = 'password';

/** Fields the provider receives in a different form than the config holds. */
const PROVIDER_FORM: Readonly<Record<string, (raw: string) => string>> = {
  phoneNumber: toProviderPhone,
};

/**
 * The login fields that identify an account at a bank.
 * @param companyType - Provider company id of the bank.
 * @returns The declared login fields minus the password; none for an unknown bank.
 */
function identityFieldsOf(companyType: string): readonly string[] {
  if (!Object.hasOwn(SCRAPERS, companyType)) return [];
  const { loginFields } = SCRAPERS[companyType as keyof typeof SCRAPERS];
  return loginFields.filter((field) => field !== SECRET_LOGIN_FIELD);
}

/**
 * One identity field in the form the provider receives it.
 * @param bankConfig - The account's config entry.
 * @param field - Name of the login field.
 * @returns The provider-facing value, or '' when the field is not a string.
 */
function providerValueOf(bankConfig: IBankConfig, field: string): string {
  const raw: unknown = bankConfig[field as keyof IBankConfig];
  if (typeof raw !== 'string') return '';
  if (!Object.hasOwn(PROVIDER_FORM, field)) return raw;
  return PROVIDER_FORM[field](raw);
}

/**
 * Fingerprints the login a config entry logs in with at a bank.
 *
 * <p>A login with no identity — a bank the scraper does not declare, or an
 * identity field that is missing or empty in the form the provider would
 * receive — gets no fingerprint, so no token can be bound to or replayed
 * for it.
 * @param companyType - Provider company id of the bank.
 * @param bankConfig - The account's config entry.
 * @returns SHA-256 of the bank and its identity values as 64 lowercase hex
 *          characters, or a failure naming the bank.
 */
export default function loginFingerprint(
  companyType: string, bankConfig: IBankConfig,
): Procedure<string> {
  const identity = identityFieldsOf(companyType).map((field) => providerValueOf(bankConfig, field));
  if (identity.length === 0 || identity.includes('')) {
    return fail(`No login identity to fingerprint for ${companyType}`);
  }
  const input = JSON.stringify([companyType, ...identity]);
  const fingerprint = createHash('sha256').update(input, 'utf8').digest('hex');
  return succeed(fingerprint);
}
