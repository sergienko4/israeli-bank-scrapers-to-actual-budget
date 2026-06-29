/**
 * Pure config mutation + masking helpers for the portal API. Adding/removing
 * banks and targets are immutable transforms; masking redacts secrets for the
 * GET response so credentials never leave the box in plaintext.
 */

import SECRET_KEYS from '../Config/SecretKeys.js';
import type { IBankConfig, IBankTarget, IImporterConfig } from '../Types/Index.js';
import { hashPassword, isEncodedHash } from './PortalPassword.js';

const MASK = '********';

/**
 * Restores masked secrets in an incoming value from the previous values, so a
 * round-tripped MASK never overwrites a real secret. Arrays are recursed
 * element-wise (mirroring {@link maskSecrets}) so secrets nested inside list
 * items are restored too.
 * @param next - Incoming (possibly masked) value from the UI.
 * @param prev - Previous stored value to restore from.
 * @returns next with MASK secrets replaced by prev's values.
 */
export function restoreMasked<T>(next: T, prev: unknown): T {
  if (Array.isArray(next)) {
    const prevArr = Array.isArray(prev) ? prev : [];
    return next.map((v, i) => restoreMasked<unknown>(v, prevArr[i])) as unknown as T;
  }
  if (!next || typeof next !== 'object') return next;
  const before = (prev ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(next)) {
    out[k] = v === MASK ? before[k] : restoreMasked(v, before[k]);
  }
  return out as T;
}

/**
 * Hashes a freshly-typed plaintext portal password. The UI password field
 * accepts a plaintext value; when it is not already an encoded scrypt hash (and
 * not empty), it is hashed here on save so password/`both` auth works without
 * the user pre-computing a hash. An untouched field arrives as the MASK and has
 * already been restored to the stored hash by {@link restoreMasked}.
 * @param config - Config whose `portal.passwordHash` may be plaintext.
 * @returns A new config with `portal.passwordHash` encoded when applicable.
 */
export function hashPlainPortalPassword(config: IImporterConfig): IImporterConfig {
  const { portal } = config;
  const value = portal?.passwordHash;
  if (!portal || !value || isEncodedHash(value)) return config;
  return { ...config, portal: { ...portal, passwordHash: hashPassword(value) } };
}

/**
 * Recursively replaces secret-keyed string values with a mask sentinel.
 * @param value - Any config sub-tree.
 * @returns A masked deep copy (objects/arrays recursed; primitives passed through).
 */
export function maskSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map(maskSecrets) as unknown as T;
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEYS.includes(k) && typeof v === 'string' && v ? MASK : maskSecrets(v);
  }
  return out as T;
}

/**
 * Cleans a raw account list to non-empty trimmed strings, or 'all' if none.
 * @param items - Candidate account entries.
 * @returns A non-empty string list, or the 'all' sentinel.
 */
function cleanAccountList(items: readonly unknown[]): string[] | 'all' {
  const cleaned = items
    .filter((a): a is string => typeof a === 'string' && a.trim() !== '')
    .map(a => a.trim());
  return cleaned.length ? cleaned : 'all';
}

/**
 * Coerces a raw `accounts` value (the UI sends a string) into the importer's
 * `string[] | 'all'` shape: the 'all' sentinel, or a comma/space-separated list
 * split into trimmed account numbers. Empty input falls back to 'all'.
 * @param value - Raw accounts value from the UI (string or already-typed).
 * @returns The normalized accounts value.
 */
export function coerceAccounts(value: unknown): string[] | 'all' {
  if (Array.isArray(value)) return cleanAccountList(value);
  if (typeof value !== 'string') return 'all';
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'all') return 'all';
  const parts = trimmed.split(/[\s,]+/);
  return cleanAccountList(parts);
}

/**
 * Normalizes every target's `accounts` field within a single bank.
 * @param bank - Bank config whose targets to normalize.
 * @returns A new bank config with coerced target accounts.
 */
function coerceBankTargets(bank: IBankConfig): IBankConfig {
  if (!bank.targets) return bank;
  const targets: IBankTarget[] = bank.targets.map(
    target => ({ ...target, accounts: coerceAccounts(target.accounts) }),
  );
  return { ...bank, targets };
}

/**
 * Normalizes every bank target's `accounts` field to `string[] | 'all'` before
 * validation/persistence, so a UI string never reaches the strict loader.
 * @param config - Config whose bank targets to normalize.
 * @returns A new config with coerced target accounts.
 */
export function coerceTargetAccounts(config: IImporterConfig): IImporterConfig {
  const entries = Object.entries(config.banks).map(
    ([name, bank]) => [name, coerceBankTargets(bank)] as const,
  );
  return { ...config, banks: Object.fromEntries(entries) };
}

/**
 * Adds or replaces a bank entry, returning a new config.
 * @param config - Current config.
 * @param name - Bank id key.
 * @param bank - Bank config to set.
 * @returns New config with the bank applied.
 */
export function addBank(config: IImporterConfig, name: string, bank: IBankConfig): IImporterConfig {
  return { ...config, banks: { ...config.banks, [name]: bank } };
}

/**
 * Removes a bank entry, returning a new config.
 * @param config - Current config.
 * @param name - Bank id key to remove.
 * @returns New config without the bank.
 */
export function removeBank(config: IImporterConfig, name: string): IImporterConfig {
  const kept = Object.entries(config.banks).filter(([key]) => key !== name);
  const banks = Object.fromEntries(kept);
  return { ...config, banks };
}
