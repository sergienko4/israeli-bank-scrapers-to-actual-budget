/**
 * Per-bank credential requirements — the single source of truth for which
 * IBankConfig fields are mandatory for each supported bank.
 *
 * Kept separate from ConfigLoaderValidator so that:
 *  - the validator file stays under its 300-line cap, and
 *  - tests can iterate over the specs without pulling in the validator
 *    surface, avoiding accidental coupling between fixtures and runtime
 *    helpers.
 *
 * OCP: add new banks by adding entries — no if/else changes needed.
 */

import type { IBankConfig } from '../Types/Index.js';

/** Per-bank credential requirements used by `validateRequiredCredentials`. */
export interface ICredentialSpec {
  /** Human-readable name used in user-facing error messages. */
  readonly displayName: string;
  /** Required IBankConfig fields for this bank. */
  readonly required: readonly (keyof IBankConfig)[];
  /** Concatenated field label used in error messages (e.g. "id, password, num"). */
  readonly label: string;
}

/** Frozen credential spec map keyed by lowercased bank id. */
export const CREDENTIAL_SPECS: Readonly<Record<string, ICredentialSpec>> = Object.freeze({
  discount:  { displayName: 'Discount bank', required: ['id', 'password', 'num'],
    label: 'id, password, num' },
  leumi:     { displayName: 'leumi',         required: ['username', 'password'],
    label: 'username, password' },
  hapoalim:  { displayName: 'Hapoalim',      required: ['userCode', 'password'],
    label: 'userCode, password' },
  yahav:     { displayName: 'Yahav',         required: ['nationalID', 'password'],
    label: 'nationalID, password' },
  onezero:   { displayName: 'OneZero',       required: ['email', 'password', 'phoneNumber'],
    label: 'email, password, phoneNumber' },
  paybox:    { displayName: 'PayBox',        required: ['phoneNumber'],
    label: 'phoneNumber' },
  pepper:    { displayName: 'Pepper',        required: ['phoneNumber', 'password'],
    label: 'phoneNumber, password' },
  max:       { displayName: 'Max',           required: ['username', 'password', 'id'],
    label: 'username, password, id' },
});
