/**
 * Config-manifest completeness gate. Compares the example config files against
 * the Config Manifest (the single source of truth) so a config key added to the
 * project without a matching manifest entry fails CI. Also asserts every enum
 * is surfaced by a manifest `select`. The CLI wrapper (config/check-manifest)
 * and the ManifestGate unit test both call `checkManifest`.
 */

import { BANK_CATALOG } from '../Types/BankCatalog.js';
import {
  CATEGORIZATION_MODES, LOG_FORMATS, MESSAGE_FORMATS,
  PORTAL_AUTH_MODES, SHOW_TRANSACTIONS_OPTIONS, WEBHOOK_FORMATS,
} from '../Types/Index.js';
import { BANK_REQUIREMENTS, CONFIG_MANIFEST } from './ConfigManifest.js';
import type { IManifestField, IManifestSection } from './Manifest/ManifestTypes.js';
import { flattenConfigPaths, join, type Json, manifestKnownPaths } from './ManifestPaths.js';

/** Parsed example files validated against the manifest. */
export interface IManifestExamples {
  /** Parsed config.json.example. */
  config: Json;
  /** Parsed credentials.json.example. */
  credentials: Json;
}

/** Every enum array that must be surfaced by a manifest `select` field. */
const ENUMS: readonly (readonly string[])[] = [
  CATEGORIZATION_MODES, LOG_FORMATS, MESSAGE_FORMATS,
  PORTAL_AUTH_MODES, SHOW_TRANSACTIONS_OPTIONS, WEBHOOK_FORMATS,
];

/**
 * Recursively gathers every field in a list (including nested group/list fields).
 * @param fields - Fields to flatten.
 * @returns A flat list of all fields and their descendants.
 */
function flattenFields(fields: readonly IManifestField[]): IManifestField[] {
  const out: IManifestField[] = [];
  for (const field of fields) {
    out.push(field);
    if (field.fields) out.push(...flattenFields(field.fields));
  }
  return out;
}

/**
 * Gathers every field a section carries across all of its slots.
 * @param section - Manifest section.
 * @returns A flat list of all fields the section declares.
 */
function sectionAllFields(section: IManifestSection): IManifestField[] {
  const slots = [section.fields, section.itemFields, section.bankFields, section.targetFields];
  const present = slots.filter((slot): slot is readonly IManifestField[] => Boolean(slot));
  return present.flatMap(flattenFields);
}

/**
 * JSON-encodes every select field's options across the manifest.
 * @returns A set of JSON-encoded option arrays used by manifest selects.
 */
function selectOptionSets(): Set<string> {
  const all = CONFIG_MANIFEST.flatMap(sectionAllFields);
  const selects = all.filter(field => field.kind === 'select' && field.options);
  const encoded = selects.map(field => JSON.stringify(field.options));
  return new Set(encoded);
}

/**
 * Returns errors for enum arrays not surfaced by any manifest select.
 * @returns One error per enum array missing from the manifest selects.
 */
export function enumCoverageErrors(): string[] {
  const known = selectOptionSets();
  const errors: string[] = [];
  for (const values of ENUMS) {
    const encoded = JSON.stringify(values);
    if (!known.has(encoded)) {
      errors.push(`Enum [${values.join(', ')}] is not referenced by any manifest select`);
    }
  }
  return errors;
}

/**
 * Returns errors for example paths absent from the manifest known-path set.
 * @param example - Parsed example object.
 * @param label - File label used in error messages.
 * @param known - Manifest known-path set.
 * @returns One error per example path with no manifest entry.
 */
function missingPathErrors(example: Json, label: string, known: Set<string>): string[] {
  const paths = flattenConfigPaths(example);
  const errors: string[] = [];
  for (const path of paths) {
    if (!known.has(path)) errors.push(`${label}: "${path}" has no manifest entry`);
  }
  return errors;
}

/**
 * Returns errors for catalog banks that have no manifest credential
 * requirement. BANK_REQUIREMENTS is derived from the bank catalog, so this
 * should always be empty; the gate guards against a future regression that
 * reverts the derivation and lets the catalog and manifest drift apart.
 * @returns One error per catalog bank missing a BANK_REQUIREMENTS entry.
 */
export function registryCoverageErrors(): string[] {
  const errors: string[] = [];
  for (const item of BANK_CATALOG) {
    if (!Object.hasOwn(BANK_REQUIREMENTS, item.bankId)) {
      errors.push(`Registry bank "${item.bankId}" has no manifest credential requirement`);
    }
  }
  return errors;
}

/**
 * Walks fields carrying whether they sit inside a list (array) container,
 * collecting the dotted paths of any secret fields found there.
 * @param fields - Fields to walk.
 * @param prefix - Dotted path prefix.
 * @param inList - Whether these fields are inside an array container.
 * @returns Secret-field dotted paths that sit inside a list.
 */
function listSecretPaths(
  fields: readonly IManifestField[], prefix: string, inList: boolean
): string[] {
  const out: string[] = [];
  for (const field of fields) {
    const path = join(prefix, field.key);
    if (inList && field.kind === 'secret') out.push(path);
    if (field.fields) {
      out.push(...listSecretPaths(field.fields, path, inList || field.kind === 'list'));
    }
  }
  return out;
}

/**
 * Collects secret fields a section declares inside any list/array container.
 * `itemFields` and `targetFields` are array items (inList); `fields`/`bankFields`
 * are object slots whose list-kind children flip their own descendants inList.
 * @param section - Manifest section.
 * @returns Dotted paths of secrets that would sit inside an array.
 */
export function sectionListSecrets(section: IManifestSection): string[] {
  const { key } = section;
  const fromFields = section.fields ? listSecretPaths(section.fields, key, false) : [];
  const fromItems = section.itemFields ? listSecretPaths(section.itemFields, key, true) : [];
  const fromBanks = section.bankFields ? listSecretPaths(section.bankFields, 'banks.*', false) : [];
  const fromTargets = section.targetFields
    ? listSecretPaths(section.targetFields, 'banks.*.targets', true) : [];
  return [...fromFields, ...fromItems, ...fromBanks, ...fromTargets];
}

/**
 * Returns errors for secret fields declared inside a list/array container. The
 * secret splitter cannot relocate such secrets because the loader's deep-merge
 * replaces arrays wholesale, so the gate forbids declaring them there.
 * @returns One error per secret field found under a list.
 */
export function listSecretErrors(): string[] {
  const paths = CONFIG_MANIFEST.flatMap(sectionListSecrets);
  return paths.map(
    path => `Secret field "${path}" is declared inside a list; secrets cannot live in arrays`,
  );
}

/**
 * Validates the example config + credentials against the manifest SSoT, the
 * enum-coverage rule, and registry/manifest bank coverage.
 * @param examples - Parsed config.json.example + credentials.json.example.
 * @returns A list of human-readable errors (empty array means valid).
 */
export function checkManifest(examples: IManifestExamples): string[] {
  const known = manifestKnownPaths();
  const configErrors = missingPathErrors(examples.config, 'config.json.example', known);
  const credErrors = missingPathErrors(examples.credentials, 'credentials.json.example', known);
  const enumErrors = enumCoverageErrors();
  return [
    ...configErrors, ...credErrors, ...enumErrors,
    ...registryCoverageErrors(), ...listSecretErrors(),
  ];
}
