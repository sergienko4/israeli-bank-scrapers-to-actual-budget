/**
 * Splits a merged IImporterConfig into a settings half (config.json) and a
 * secrets half (credentials.json). Keeps passwords, tokens, and portal auth
 * secrets out of the non-encrypted settings file so the portal can persist a
 * config edit without ever writing plaintext credentials to config.json.
 */

import type { IBankConfig, IImporterConfig } from '../Types/Index.js';

/** Bank fields treated as secret and routed to credentials.json. */
const SECRET_BANK_FIELDS = ['password', 'otpLongTermToken'] as const;

/** Settings + secrets halves produced by {@link splitSecrets}. */
export interface ISplitConfig {
  settings: IImporterConfig;
  secrets: Partial<IImporterConfig>;
}

/**
 * Moves a bank's secret fields into the secrets bucket, leaving settings clean.
 * @param name - Bank id key.
 * @param bank - Bank config to scan for secret fields.
 * @param secrets - Mutable secrets bucket keyed by bank id.
 * @returns The bank config without its secret fields.
 */
function extractBankSecrets(
  name: string, bank: IBankConfig, secrets: Record<string, IBankConfig>,
): IBankConfig {
  const secretSet = new Set<string>(SECRET_BANK_FIELDS);
  for (const field of SECRET_BANK_FIELDS) {
    if (bank[field] === undefined) continue;
    secrets[name] = { ...secrets[name], [field]: bank[field] };
  }
  const kept = Object.entries(bank).filter(([key]) => !secretSet.has(key));
  return Object.fromEntries(kept);
}

/**
 * Splits banks into settings + secrets, preserving every non-secret field.
 * @param config - The merged importer config.
 * @returns Pair of cleaned bank settings and per-bank secret fields.
 */
function splitBanks(config: IImporterConfig): {
  banks: Record<string, IBankConfig>; secretBanks: Record<string, IBankConfig>;
} {
  const banks: Record<string, IBankConfig> = {};
  const secretBanks: Record<string, IBankConfig> = {};
  for (const [name, bank] of Object.entries(config.banks)) {
    banks[name] = extractBankSecrets(name, bank, secretBanks);
  }
  return { banks, secretBanks };
}

/**
 * Splits a merged config into non-secret settings and secret credentials.
 * @param config - The merged importer config to divide.
 * @returns ISplitConfig with settings (config.json) and secrets (credentials.json).
 */
export default function splitSecrets(config: IImporterConfig): ISplitConfig {
  const { banks, secretBanks } = splitBanks(config);
  return { settings: { ...config, banks }, secrets: { banks: secretBanks } };
}
