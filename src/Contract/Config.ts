/**
 * Contract for the config routes — the masked read, the validated write, the
 * dry-run validation report, and the per-bank add/remove routes.
 *
 * Secret-bearing fields are returned masked and are preserved on write when the
 * client sends the mask back unchanged, so the config object is deliberately
 * open: its shape is described by the manifest, not by this schema.
 */

import { type Static, Type } from '@sinclair/typebox';

/**
 * The importer's config as JSON. Intentionally unconstrained — the manifest
 * describes which keys exist, and constraining it here would let a schema
 * change silently drop a config field from both clients.
 */
export const CONFIG_BODY = Type.Record(Type.String(), Type.Unknown(), {
  description: 'The merged config, with every secret field masked on read.',
});

/** One check performed against a candidate config. */
export const VALIDATION_RESULT = Type.Object({
  status: Type.Union([Type.Literal('pass'), Type.Literal('fail'), Type.Literal('warn')], {
    description: 'Whether the check passed, failed, or produced a warning.',
  }),
  check: Type.String({ description: 'Dotted path of the field checked.' }),
  message: Type.String({ description: 'Human-readable description of the result.' }),
});

/** The POST /api/validate 200 body: every check, passed or not. */
export const VALIDATION_REPORT = Type.Array(VALIDATION_RESULT, {
  description: 'Every check run against the candidate config.',
});

/** Path parameters for the per-bank routes. */
export const BANK_PARAMS = Type.Object({
  name: Type.String({ minLength: 1, description: 'Bank id to add or remove.' }),
});

/**
 * One bank's entry in the config. Open for the same reason as the config
 * itself: the manifest, not this schema, decides which credential keys a bank
 * carries.
 */
export const BANK_BODY = Type.Record(Type.String(), Type.Unknown(), {
  description: "One bank's configuration entry.",
});

/** The importer's config as JSON. */
export type ConfigBody = Static<typeof CONFIG_BODY>;

/** One check performed against a candidate config. */
export type ValidationResult = Static<typeof VALIDATION_RESULT>;

/** The POST /api/validate 200 body. */
export type ValidationReport = Static<typeof VALIDATION_REPORT>;

/** Path parameters for the per-bank routes. */
export type BankParams = Static<typeof BANK_PARAMS>;

/** One bank's entry in the config. */
export type BankBody = Static<typeof BANK_BODY>;
