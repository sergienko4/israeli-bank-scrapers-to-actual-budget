/**
 * Per-bank credential specs, DERIVED from the Config Manifest.
 *
 * The manifest (`Manifest/BankManifest.ts` → `BANK_REQUIREMENTS`) is the single
 * source of truth for which IBankConfig fields are mandatory per bank. This
 * module shapes that data into the `ICredentialSpec` map the validator and the
 * tests already consume, computing `label` as the comma-joined required list.
 *
 * OCP: add new banks by adding a manifest entry — no changes needed here.
 */

import type { IBankConfig } from '../Types/Index.js';
import { BANK_REQUIREMENTS } from './Manifest/BankManifest.js';

/** Per-bank credential requirements used by `validateRequiredCredentials`. */
export interface ICredentialSpec {
  /** Human-readable name used in user-facing error messages. */
  readonly displayName: string;
  /** Required IBankConfig fields for this bank. */
  readonly required: readonly (keyof IBankConfig)[];
  /** Concatenated field label used in error messages (e.g. "id, password, num"). */
  readonly label: string;
}

/**
 * Builds the frozen credential-spec map from the manifest bank requirements.
 * @returns Per-bank credential specs keyed by lowercased bank id.
 */
function buildCredentialSpecs(): Readonly<Record<string, ICredentialSpec>> {
  const entries = Object.entries(BANK_REQUIREMENTS).map(([bankId, req]) => [
    bankId,
    Object.freeze({
      displayName: req.displayName, required: req.required, label: req.required.join(', '),
    }),
  ] as const);
  const specs = Object.fromEntries(entries);
  return Object.freeze(specs);
}

/** Frozen credential spec map keyed by lowercased bank id. */
export const CREDENTIAL_SPECS: Readonly<Record<string, ICredentialSpec>> = buildCredentialSpecs();
