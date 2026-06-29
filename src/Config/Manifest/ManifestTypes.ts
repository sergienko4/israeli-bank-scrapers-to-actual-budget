/**
 * Types for the Config Manifest — the single source of truth describing every
 * configuration field (its kind, whether it is a secret, options, help text,
 * and documentation link). The portal UI, the secret-key list, the per-bank
 * credential specs, and the CI completeness gate all derive from the manifest.
 */

import type { IBankConfig } from '../../Types/Index.js';

/** How a field is edited/rendered (and how the portal coerces its value). */
export type FieldKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'secret'
  | 'select'
  | 'date'
  | 'group'
  | 'list';

/** One configuration field: a leaf, a nested group, or a list. */
export interface IManifestField {
  /** Object key exactly as it appears in config.json. */
  key: string;
  /** Human-readable label for the UI. */
  label: string;
  /** Edit/render kind. */
  kind: FieldKind;
  /** Whether the field is required for a valid config. */
  required?: boolean;
  /** Allowed values for `select` kinds. */
  options?: readonly string[];
  /** Short inline help text. */
  help?: string;
  /** Minimum value for numeric fields. */
  min?: number;
  /** Maximum value for numeric fields. */
  max?: number;
  /** Nested fields for `group` kinds, or item shape for object `list` kinds. */
  fields?: readonly IManifestField[];
}

/** How a whole section is structured for rendering. */
export type SectionKind = 'object' | 'bankMap' | 'list';

/** One top-level config section (maps to a key of IImporterConfig). */
export interface IManifestSection {
  /** Top-level config key (e.g. 'actual', 'banks'); '' targets the root. */
  key: string;
  /** Human-readable section label. */
  label: string;
  /** Emoji/icon for the nav. */
  icon?: string;
  /** Structural kind. */
  kind: SectionKind;
  /** Section documentation path under docs/. */
  doc?: string;
  /** Fields for `object` sections (may nest groups). */
  fields?: readonly IManifestField[];
  /** Item field shape for `list` sections (e.g. spendingWatch rules). */
  itemFields?: readonly IManifestField[];
  /** Per-bank-entry fields for `bankMap` sections. */
  bankFields?: readonly IManifestField[];
  /** Per-target fields for `bankMap` sections. */
  targetFields?: readonly IManifestField[];
}

/** Per-bank credential requirement: display name + required field keys. */
export interface IBankRequirement {
  /** User-facing bank name used in validation error messages. */
  displayName: string;
  /** Required IBankConfig field keys for this bank. */
  required: readonly (keyof IBankConfig)[];
}
