/**
 * Manifest entries for the banks section: the catalog of editable per-bank
 * fields, the per-target fields, and each supported bank's required credentials
 * — the single source consumed by CREDENTIAL_SPECS.
 */

import { type CompanyTypes, SCRAPERS } from '@sergienko4/israeli-bank-scrapers';

import { BANK_CATALOG } from '../../Types/BankCatalog.js';
import type { IBankConfig } from '../../Types/Index.js';
import type { IBankRequirement, IManifestField, IManifestSection } from './ManifestTypes.js';

/**
 * Editable fields shown on every bank card. Every login identifier (id, num,
 * userCode, username, nationalID, card6Digits, email, phoneNumber) is `secret`,
 * not just the password: each is a bank credential, so it must be masked in the
 * UI and routed to the encryptable credentials.json — never written in
 * plaintext to config.json.
 */
const BANK_FIELDS: readonly IManifestField[] = [
  {
    key: 'daysBack', label: 'Days back', kind: 'number', min: 1, max: 30,
    help: 'Import the last N days (1-30). Cannot combine with start date.',
  },
  {
    key: 'startDate', label: 'Start date', kind: 'date',
    help: 'Fixed YYYY-MM-DD (max 1 year back). Cannot combine with days back.',
  },
  { key: 'id', label: 'ID', kind: 'secret', help: 'Bank user/account id.' },
  { key: 'password', label: 'Password', kind: 'secret', help: 'Bank password.' },
  { key: 'num', label: 'Num', kind: 'secret', help: 'Bank-specific number/code.' },
  { key: 'userCode', label: 'User code', kind: 'secret', help: 'Hapoalim user code.' },
  { key: 'username', label: 'Username', kind: 'secret', help: 'Login username.' },
  { key: 'nationalID', label: 'National ID', kind: 'secret', help: 'Yahav national ID.' },
  {
    key: 'card6Digits', label: 'Card 6 digits', kind: 'secret',
    help: 'Six card digits (Isracard/Amex).',
  },
  { key: 'email', label: 'Email', kind: 'secret', help: 'Login email.' },
  { key: 'phoneNumber', label: 'Phone number', kind: 'secret', help: 'E.g. 9725XXXXXXXX.' },
  {
    key: 'otpLongTermToken', label: 'OTP long-term token', kind: 'secret',
    help: 'Saved after first 2FA login to skip OTP next time.',
  },
  {
    key: 'twoFactorAuth', label: 'Two-factor auth', kind: 'boolean',
    help: 'true = bot asks for SMS OTP via Telegram.',
  },
  {
    key: 'twoFactorTimeout', label: '2FA timeout (s)', kind: 'number', min: 1,
    help: 'Seconds to wait for OTP reply. Default 300.',
  },
  {
    key: 'clearSession', label: 'Clear session', kind: 'boolean',
    help: 'No-op with Camoufox; kept for backward compatibility.',
  },
  {
    key: 'timeout', label: 'Navigation timeout (ms)', kind: 'number', min: 0,
    help: 'Navigation timeout in ms. Default 30000.',
  },
  {
    key: 'navigationRetryCount', label: 'Navigation retries', kind: 'number', min: 0,
    help: 'Retries on page load failure. Default 0.',
  },
];

/** Fields for each Actual Budget target under a bank. */
const TARGET_FIELDS: readonly IManifestField[] = [
  {
    key: 'actualAccountId', label: 'Actual account id', kind: 'string', required: true,
    help: 'UUID from the Actual Budget account URL.',
  },
  {
    key: 'accountName', label: 'Account name', kind: 'string',
    help: 'Optional friendly label shown in logs and Telegram.',
  },
  {
    key: 'accounts', label: 'Accounts', kind: 'string',
    help: '"all" or comma-separated bank account numbers.',
  },
  {
    key: 'reconcile', label: 'Reconcile', kind: 'boolean',
    help: 'true = auto-adjust balance to match the bank.',
  },
];

/** Banks section descriptor. */
export const BANKS_SECTION: IManifestSection = {
  key: 'banks', label: 'Banks', icon: '🏦', kind: 'bankMap',
  doc: 'configuration/banks.md', bankFields: BANK_FIELDS, targetFields: TARGET_FIELDS,
};

/**
 * Required login fields this importer enforces beyond (or instead of) the
 * scraper's declared `loginFields`, keyed by registry bankId. OneZero needs a
 * phone number for OTP; Max needs an id; Yahav logs in with a nationalID and
 * password.
 */
const REQUIRED_OVERRIDES: Readonly<Record<string, readonly (keyof IBankConfig)[]>> = {
  yahav: ['nationalID', 'password'],
  onezero: ['email', 'password', 'phoneNumber'],
  max: ['username', 'password', 'id'],
};

/** Canonical title-cased bank display names, used in the UI and importer error strings. */
const DISPLAY_NAME_OVERRIDES: Readonly<Record<string, string>> = {
  discount: 'Discount bank', leumi: 'Leumi', hapoalim: 'Hapoalim', yahav: 'Yahav',
  onezero: 'OneZero', paybox: 'PayBox', pepper: 'Pepper', max: 'Max',
};

/**
 * Resolves the scraper metadata entry (name + declared loginFields) for a
 * company type, centralising the single `keyof typeof SCRAPERS` cast.
 * @param companyType - CompanyTypes value (also the SCRAPERS key).
 * @returns The scraper descriptor for that company.
 */
function scraperFor(companyType: CompanyTypes): (typeof SCRAPERS)[keyof typeof SCRAPERS] {
  return SCRAPERS[companyType as keyof typeof SCRAPERS];
}

/**
 * Builds one bank's requirement from registry + scraper, applying overrides.
 * @param bankId - Registry bank id.
 * @param companyType - The bank's scraper company type.
 * @returns The derived per-bank credential requirement.
 */
function bankRequirement(bankId: string, companyType: CompanyTypes): IBankRequirement {
  const scraper = scraperFor(companyType);
  const required = REQUIRED_OVERRIDES[bankId] ?? scraper.loginFields;
  return { displayName: DISPLAY_NAME_OVERRIDES[bankId] ?? scraper.name, required };
}

/**
 * Builds the per-bank requirement map for EVERY registered bank.
 * @returns Frozen requirement map keyed by registry bankId.
 */
function buildBankRequirements(): Readonly<Record<string, IBankRequirement>> {
  const entries = BANK_CATALOG.map(
    item => [item.bankId, bankRequirement(item.bankId, item.companyType)] as const,
  );
  const map = Object.fromEntries(entries);
  return Object.freeze(map);
}

/**
 * Per-bank required credentials for EVERY registered bank — the single source
 * behind CREDENTIAL_SPECS. Derived from the bank registry + the scraper's
 * `loginFields`, so a bank can never be registered without a credential spec
 * (no registry/manifest drift), with documented project-specific overrides.
 */
export const BANK_REQUIREMENTS = buildBankRequirements();
