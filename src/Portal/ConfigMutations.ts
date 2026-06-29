/**
 * Pure config mutation + masking helpers for the portal API. Adding/removing
 * banks and targets are immutable transforms; masking redacts secrets for the
 * GET response so credentials never leave the box in plaintext.
 */

import type { IBankConfig, IBankTarget, IImporterConfig } from '../Types/Index.js';

const SECRET_KEYS = ['password', 'otpLongTermToken', 'sessionSecret', 'passwordHash', 'clientSecret'];
const MASK = '********';

/**
 * Restores masked secrets in an incoming object from the previous values, so a
 * round-tripped MASK never overwrites a real secret.
 * @param next - Incoming (possibly masked) value from the UI.
 * @param prev - Previous stored value to restore from.
 * @returns next with MASK secrets replaced by prev's values.
 */
export function restoreMasked<T>(next: T, prev: unknown): T {
  if (!next || typeof next !== 'object' || Array.isArray(next)) return next;
  const before = (prev ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(next)) {
    out[k] = v === MASK ? before[k] : restoreMasked(v, before[k]);
  }
  return out as T;
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

/**
 * Replaces a bank's targets array, returning a new config.
 * @param config - Current config.
 * @param name - Bank id key.
 * @param targets - Replacement targets list.
 * @returns New config with targets applied.
 */
export function setTargets(
  config: IImporterConfig, name: string, targets: IBankTarget[],
): IImporterConfig {
  const bank = config.banks[name];
  return addBank(config, name, { ...bank, targets });
}
