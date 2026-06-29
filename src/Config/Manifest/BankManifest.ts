/**
 * Manifest entries for the banks section: the catalog of editable per-bank
 * fields, the per-target fields, and each supported bank's required credentials
 * — the single source consumed by CREDENTIAL_SPECS.
 */

import type { IBankRequirement, IManifestField, IManifestSection } from './ManifestTypes.js';

/** Editable fields shown on every bank card. */
const BANK_FIELDS: readonly IManifestField[] = [
  {
    key: 'daysBack', label: 'Days back', kind: 'number', min: 1, max: 365,
    help: 'Import the last N days (1-30 typical). Cannot combine with start date.',
  },
  {
    key: 'startDate', label: 'Start date', kind: 'date',
    help: 'Fixed YYYY-MM-DD (max 1 year back). Cannot combine with days back.',
  },
  { key: 'id', label: 'ID', kind: 'string', help: 'Bank user/account id.' },
  { key: 'password', label: 'Password', kind: 'secret', help: 'Bank password.' },
  { key: 'num', label: 'Num', kind: 'string', help: 'Bank-specific number/code.' },
  { key: 'userCode', label: 'User code', kind: 'string', help: 'Hapoalim user code.' },
  { key: 'username', label: 'Username', kind: 'string', help: 'Login username.' },
  { key: 'nationalID', label: 'National ID', kind: 'string', help: 'Yahav national ID.' },
  {
    key: 'card6Digits', label: 'Card 6 digits', kind: 'string',
    help: 'Six card digits (Isracard/Amex).',
  },
  { key: 'email', label: 'Email', kind: 'string', help: 'Login email.' },
  { key: 'phoneNumber', label: 'Phone number', kind: 'string', help: 'E.g. 9725XXXXXXXX.' },
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
    help: '"all" or specific bank account numbers.',
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

/** Per-bank required credentials — the single source behind CREDENTIAL_SPECS. */
export const BANK_REQUIREMENTS: Readonly<Record<string, IBankRequirement>> = {
  discount: { displayName: 'Discount bank', required: ['id', 'password', 'num'] },
  leumi: { displayName: 'leumi', required: ['username', 'password'] },
  hapoalim: { displayName: 'Hapoalim', required: ['userCode', 'password'] },
  yahav: { displayName: 'Yahav', required: ['nationalID', 'password'] },
  onezero: { displayName: 'OneZero', required: ['email', 'password', 'phoneNumber'] },
  paybox: { displayName: 'PayBox', required: ['phoneNumber'] },
  pepper: { displayName: 'Pepper', required: ['phoneNumber', 'password'] },
  max: { displayName: 'Max', required: ['username', 'password', 'id'] },
};
