/**
 * Dotted-path vocabulary helpers for the config manifest. Computes the set of
 * known config paths the manifest declares and flattens an example config/
 * credentials object to its normalized leaf paths, so the ManifestGate can diff
 * the two. Pure path arithmetic with no cross-subsystem dependencies — kept
 * apart from the gate so the gate stays small and focused on producing errors.
 */

import { CONFIG_MANIFEST } from './ConfigManifest.js';
import type { IManifestField, IManifestSection } from './Manifest/ManifestTypes.js';

/** A parsed JSON object (example config or credentials file). */
export type Json = Record<string, unknown>;

/**
 * Joins a parent path with a child key (root prefix '' yields the bare key).
 * @param prefix - Parent dotted path.
 * @param key - Child key.
 * @returns The joined dotted path.
 */
export function join(prefix: string, key: string): string {
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
 * Collects section keys whose kind is `bankMap` (instances collapse to `*`).
 * @returns The set of bankMap section keys declared by the manifest.
 */
function bankMapKeys(): Set<string> {
  const keys = CONFIG_MANIFEST
    .filter(section => section.kind === 'bankMap')
    .map(section => section.key);
  return new Set(keys);
}

/** Section keys whose entries are bank instances collapsed to `*`. */
const BANK_MAP_KEYS = bankMapKeys();

/**
 * Maps an instance key under a bankMap section to the `*` placeholder.
 * @param prefix - Parent dotted path.
 * @param key - Child key.
 * @returns The child prefix (`<section>.*` when descending a bank instance).
 */
function childPrefix(prefix: string, key: string): string {
  return BANK_MAP_KEYS.has(prefix) ? `${prefix}.*` : join(prefix, key);
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
