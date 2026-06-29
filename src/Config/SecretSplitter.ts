/**
 * Splits a merged IImporterConfig into a settings half (config.json) and a
 * secrets half (credentials.json). Keeps passwords, tokens, and portal auth
 * secrets out of the non-encrypted settings file so the portal can persist a
 * config edit without ever writing plaintext credentials to config.json.
 */

import type { IImporterConfig } from '../Types/Index.js';
import SECRET_KEYS from './SecretKeys.js';

/** Secret-bearing config key names, shared with the portal masker. */
const SECRETS = new Set<string>(SECRET_KEYS);

/** Mutable record alias for recursive traversal of config branches. */
type Branch = Record<string, unknown>;

/** A value separated into its non-secret and secret parts. */
interface IPair {
  settings: unknown;
  secrets: unknown;
}

/** Settings + secrets halves produced by {@link splitSecrets}. */
export interface ISplitConfig {
  settings: IImporterConfig;
  secrets: Partial<IImporterConfig>;
}

/**
 * Whether a value is a plain (non-array) object eligible for recursion.
 *
 * Arrays are treated as atomic leaves (never recursed): the loader's deep-merge
 * replaces arrays wholesale, so a secret split out of an array element could not
 * be recombined. The manifest gate (`listSecretErrors`) structurally forbids
 * declaring a `secret` field inside any list, keeping this invariant safe.
 * @param value - Candidate value.
 * @returns True for plain objects, false for primitives, arrays, and null.
 */
function isBranch(value: unknown): value is Branch {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Whether a leaf at a secret-named key is a real secret worth relocating.
 * @param value - Leaf value found at a secret key.
 * @returns True for non-empty string secrets (skips null/empty placeholders).
 */
function isSecretLeaf(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Whether a split result is an emptied plain object that can be dropped.
 * @param value - Settings side of a split branch.
 * @returns True when value is a plain object with no remaining keys.
 */
function isEmptyBranch(value: unknown): boolean {
  return isBranch(value) && Object.keys(value).length === 0;
}

/**
 * Splits one object's keys into settings + secrets, recursing into branches.
 * @param obj - Object to divide.
 * @returns Pair of settings and secrets (secrets undefined when none found).
 */
function splitBranch(obj: Branch): IPair {
  const settings: Branch = {};
  const secrets: Branch = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SECRETS.has(key) && isSecretLeaf(value)) { secrets[key] = value; continue; }
    if (!isBranch(value)) { settings[key] = value; continue; }
    const child = splitBranch(value);
    if (!isEmptyBranch(child.settings)) settings[key] = child.settings;
    if (child.secrets !== undefined) secrets[key] = child.secrets;
  }
  return { settings, secrets: Object.keys(secrets).length ? secrets : undefined };
}

/**
 * Splits a merged config into non-secret settings and secret credentials.
 *
 * Walks the whole config tree and relocates every {@link SECRET_KEYS}-named
 * string leaf into the secrets half, so config.json never receives a plaintext
 * credential. The loader's deep-merge recombines the two halves on load.
 * @param config - The merged importer config to divide.
 * @returns ISplitConfig with settings (config.json) and secrets (credentials.json).
 */
export default function splitSecrets(config: IImporterConfig): ISplitConfig {
  const { settings, secrets } = splitBranch(config as unknown as Branch);
  return {
    settings: settings as IImporterConfig,
    secrets: secrets ?? {},
  };
}
