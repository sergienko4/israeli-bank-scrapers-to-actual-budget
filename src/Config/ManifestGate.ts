/**
 * Config-manifest completeness gate. Compares the example config files against
 * the Config Manifest (the single source of truth) so a config key added to the
 * project without a matching manifest entry fails CI. Also asserts every enum
 * is surfaced by a manifest `select`. The CLI wrapper (config/check-manifest)
 * and the ManifestGate unit test both call `checkManifest`.
 */

import {
  CATEGORIZATION_MODES, LOG_FORMATS, MESSAGE_FORMATS,
  PORTAL_AUTH_MODES, SHOW_TRANSACTIONS_OPTIONS, WEBHOOK_FORMATS,
} from '../Types/Index.js';
import { CONFIG_MANIFEST } from './ConfigManifest.js';
import type { IManifestField, IManifestSection } from './Manifest/ManifestTypes.js';

/** A parsed JSON object (example config or credentials file). */
export type Json = Record<string, unknown>;

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
 * Joins a parent path with a child key (root prefix '' yields the bare key).
 * @param prefix - Parent dotted path.
 * @param key - Child key.
 * @returns The joined dotted path.
 */
function join(prefix: string, key: string): string {
  return prefix ? `${prefix}.${key}` : key;
}

/**
 * Collects the dotted paths a field contributes, recursing groups/object-lists.
 * @param field - Manifest field.
 * @param prefix - Parent dotted path.
 * @returns The field's path plus any nested field paths.
 */
function fieldPaths(field: IManifestField, prefix: string): string[] {
  const path = join(prefix, field.key);
  const nested = field.fields ? fieldsPaths(field.fields, path) : [];
  return [path, ...nested];
}

/**
 * Collects the dotted paths for a list of fields under a prefix.
 * @param fields - Fields to walk.
 * @param prefix - Parent dotted path.
 * @returns All contributed dotted paths.
 */
function fieldsPaths(fields: readonly IManifestField[], prefix: string): string[] {
  return fields.flatMap(field => fieldPaths(field, prefix));
}

/**
 * Collects the per-target paths declared under banks.*.targets.
 * @param fields - Target fields.
 * @returns The targets container path plus each target field path.
 */
function targetPaths(fields: readonly IManifestField[]): string[] {
  const nested = fieldsPaths(fields, 'banks.*.targets');
  return ['banks.*.targets', ...nested];
}

/**
 * Collects every known dotted config path declared by a section.
 * @param section - Manifest section.
 * @returns All dotted paths the section declares (banks use a `*` instance).
 */
function sectionPaths(section: IManifestSection): string[] {
  const own = section.fields ? fieldsPaths(section.fields, section.key) : [];
  const items = section.itemFields ? fieldsPaths(section.itemFields, section.key) : [];
  const banks = section.bankFields ? fieldsPaths(section.bankFields, 'banks.*') : [];
  const targets = section.targetFields ? targetPaths(section.targetFields) : [];
  return [...own, ...items, ...banks, ...targets];
}

/**
 * Builds the set of every known dotted config path from the manifest.
 * @returns The manifest's full known-path vocabulary.
 */
export function manifestKnownPaths(): Set<string> {
  const all = CONFIG_MANIFEST.flatMap(sectionPaths);
  return new Set(all);
}

/**
 * Type-guards a plain object (a recursion target, not an array).
 * @param value - Value to test.
 * @returns True when the value is a non-null, non-array object.
 */
function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Maps an instance key under `banks` to the `*` placeholder.
 * @param prefix - Parent dotted path.
 * @param key - Child key.
 * @returns The child prefix (`banks.*` when descending a bank instance).
 */
function childPrefix(prefix: string, key: string): string {
  return prefix === 'banks' ? 'banks.*' : join(prefix, key);
}

/**
 * Emits leaf paths for a value: recurse objects, unwrap object arrays, else leaf.
 * @param value - Value to walk.
 * @param prefix - Dotted path of the value.
 * @returns The leaf paths beneath the value.
 */
function walkValuePaths(value: unknown, prefix: string): string[] {
  if (isObject(value)) return walkObjectPaths(value, prefix);
  if (Array.isArray(value)) return walkArrayPaths(value, prefix);
  return [prefix];
}

/**
 * Walks an object's entries (skipping `_`-prefixed keys) into leaf paths.
 * @param obj - Object to walk.
 * @param prefix - Dotted path of the object.
 * @returns The leaf paths beneath the object.
 */
function walkObjectPaths(obj: Json, prefix: string): string[] {
  const entries = Object.entries(obj).filter(([key]) => !key.startsWith('_'));
  return entries.flatMap(([key, value]) => {
    const next = childPrefix(prefix, key);
    return walkValuePaths(value, next);
  });
}

/**
 * Object arrays recurse (index dropped); scalar/empty arrays are leaf paths.
 * @param arr - Array to walk.
 * @param prefix - Dotted path of the array.
 * @returns The leaf paths beneath the array.
 */
function walkArrayPaths(arr: readonly unknown[], prefix: string): string[] {
  const objects = arr.filter(isObject);
  if (objects.length === 0) return [prefix];
  return objects.flatMap(item => walkObjectPaths(item, prefix));
}

/**
 * Flattens an example config object to normalized leaf paths.
 * @param obj - Parsed example object.
 * @returns Normalized leaf paths (banks collapsed to `*`, array index dropped).
 */
export function flattenConfigPaths(obj: Json): string[] {
  return walkObjectPaths(obj, '');
}

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
 * Validates the example config + credentials against the manifest SSoT and the
 * enum-coverage rule.
 * @param examples - Parsed config.json.example + credentials.json.example.
 * @returns A list of human-readable errors (empty array means valid).
 */
export function checkManifest(examples: IManifestExamples): string[] {
  const known = manifestKnownPaths();
  const configErrors = missingPathErrors(examples.config, 'config.json.example', known);
  const credErrors = missingPathErrors(examples.credentials, 'credentials.json.example', known);
  const enumErrors = enumCoverageErrors();
  return [...configErrors, ...credErrors, ...enumErrors];
}
