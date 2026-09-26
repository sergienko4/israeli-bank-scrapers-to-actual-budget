/**
 * The three API-direct banks, described the way their login works.
 *
 * <p>OneZero, Pepper and PayBox log in through an API with an SMS code, and
 * mint a long-term token that later logins send instead. The rows below are
 * written down from what each bank does, not derived from the importer's
 * code, so a fake bank built from them stays independent of the code it
 * checks. `ApiDirectBankContract.test.ts` holds each row against upstream's
 * published metadata and the importer's registry, so a row cannot drift.
 */

import { faker } from '@faker-js/faker';

import type { IBankConfig } from '../../src/Types/Index.js';
import { fakeUuid, fakeValidBankConfigFor } from './factories.js';

/** Seconds in one year of 365 days. */
const YEAR_SECONDS = 365 * 24 * 60 * 60;

/** A config field a bank knows an account by. */
export type AccountField = 'email' | 'phoneNumber';

/** One API-direct bank, as its login works. */
export interface IApiDirectBank {
  /** Display name, for test titles. */
  readonly name: string;
  /** The importer's registry id, the first half of the store key. */
  readonly bankId: string;
  /** Upstream's company id, which picks the scraper. */
  readonly companyType: string;
  /** Two `banks` entry names that resolve to this bank, for a second account. */
  readonly entries: readonly [string, string];
  /** The credential fields upstream logs in with. */
  readonly loginFields: readonly string[];
  /** The login field the bank knows the account by. */
  readonly accountField: AccountField;
  /** How long a minted token is valid. */
  readonly tokenLifetimeSeconds: number;
  /**
   * Adds the bank's own claims to a minted token's payload.
   * @returns Claims beyond `iat`, `exp` and `jti`.
   */
  readonly tokenClaims: () => Readonly<Record<string, unknown>>;
}

/**
 * Adds no claims, for banks whose token payload upstream does not read.
 * @returns No claims.
 */
function noClaims(): Readonly<Record<string, unknown>> {
  return {};
}

/**
 * Adds the PayBox user id, which upstream reads from `pl.uId` on a warm login.
 * @returns The `pl` claim.
 */
function payBoxClaims(): Readonly<Record<string, unknown>> {
  return { pl: { uId: fakeUuid() } };
}

/**
 * The API-direct banks.
 *
 * <p>OneZero's token is its `idToken`, valid for ten years (upstream 8.7.3).
 * Pepper and PayBox do not publish a lifetime; the importer never reads one,
 * so their rows use a year.
 */
export const API_DIRECT_BANKS: readonly IApiDirectBank[] = Object.freeze([
  {
    name: 'OneZero', bankId: 'onezero', companyType: 'oneZero', entries: ['oneZero', 'onezero'],
    loginFields: ['email', 'password'], accountField: 'email',
    tokenLifetimeSeconds: 10 * YEAR_SECONDS, tokenClaims: noClaims,
  },
  {
    name: 'Pepper', bankId: 'pepper', companyType: 'pepper', entries: ['pepper', 'Pepper'],
    loginFields: ['phoneNumber', 'password'], accountField: 'phoneNumber',
    tokenLifetimeSeconds: YEAR_SECONDS, tokenClaims: noClaims,
  },
  {
    name: 'PayBox', bankId: 'paybox', companyType: 'payBox', entries: ['payBox', 'paybox'],
    loginFields: ['phoneNumber'], accountField: 'phoneNumber',
    tokenLifetimeSeconds: YEAR_SECONDS, tokenClaims: payBoxClaims,
  },
]);

/**
 * Draws an Israeli mobile number in the digits-only form the provider receives.
 * @returns `9725` followed by eight digits.
 */
export function fakeIsraeliMobile(): string {
  return `9725${faker.string.numeric(8)}`;
}

/** Draws a fresh value for each account field. */
const ACCOUNT_VALUE_DRAWS: Readonly<Record<AccountField, () => string>> = {
  email: () => faker.internet.email(),
  phoneNumber: fakeIsraeliMobile,
};

/**
 * Draws a value for the field a bank knows accounts by.
 * @param bank - The bank.
 * @returns A new email or mobile number.
 */
export function drawAccountValue(bank: IApiDirectBank): string {
  return ACCOUNT_VALUE_DRAWS[bank.accountField]();
}

/**
 * Builds a `banks` entry for the bank with a login of its own and 2FA on.
 * @param bank - The bank.
 * @param overrides - Fields a case pins.
 * @returns The entry.
 */
export function apiDirectEntry(bank: IApiDirectBank, overrides: Partial<IBankConfig> = {}): IBankConfig {
  return fakeValidBankConfigFor(bank.bankId, {
    twoFactorAuth: true, phoneNumber: fakeIsraeliMobile(), ...overrides,
  });
}

/**
 * Reads an entry's value for one login field.
 * @param bankConfig - The entry.
 * @param field - A login field name.
 * @returns The value, or undefined when the entry has none.
 */
function fieldOf(bankConfig: IBankConfig, field: string): unknown {
  return bankConfig[field as keyof IBankConfig];
}

/**
 * Lists the values the bank expects for each login field of an entry.
 *
 * <p>The entries hold digits-only phone numbers, which is the form the
 * provider receives, so each value is the entry's own.
 * @param bank - The bank.
 * @param bankConfig - The entry.
 * @returns Each upstream login field and its value.
 */
export function loginValuesOf(bank: IApiDirectBank, bankConfig: IBankConfig): Readonly<Record<string, unknown>> {
  return Object.fromEntries(bank.loginFields.map((field) => [field, fieldOf(bankConfig, field)]));
}

/**
 * Names the account an entry logs in to.
 * @param bank - The bank.
 * @param bankConfig - The entry.
 * @returns The entry's email or phone number.
 */
export function accountOf(bank: IApiDirectBank, bankConfig: IBankConfig): string {
  const value = fieldOf(bankConfig, bank.accountField);
  if (typeof value !== 'string') throw new Error(`A ${bank.name} entry needs a ${bank.accountField}`);
  return value;
}
