/**
 * Deep-merge helpers for IImporterConfig objects.
 *
 * Used by ConfigLoader to merge an optional credentials.json onto the main
 * config.json (or to merge env overrides onto a parsed config). The merge
 * is recursive for plain objects and "source wins" for primitives and arrays.
 * A `__proto__` key is never merged: `JSON.parse` keeps it as an ordinary
 * key, and assigning it would set the merged object's prototype, giving a
 * bank values it only inherits, which the secret masker never sees.
 */

import { POLLUTING_KEY } from '../../Storage/StoreRecords.js';
import type { IImporterConfig } from '../../Types/Index.js';

/** Type for values in nested config merge objects. */
type ConfigValue = object | string | number | boolean | null;

/** Type alias for nested config merge objects. */
type ConfigRecord = Record<string, ConfigValue>;

/**
 * Lists the source's own entries that are safe to assign.
 *
 * @param source - The object whose entries are merged.
 * @returns Its entries, without the key that would set a prototype.
 */
function mergeableEntries(source: object): [string, ConfigValue][] {
  const entries = Object.entries(source as ConfigRecord);
  return entries.filter(([key]) => key !== POLLUTING_KEY);
}

/**
 * Recursively merges a single source value into a target value.
 *
 * @param target - The existing value from the base config.
 * @param source - The incoming value from the credentials/override config.
 * @returns The merged value (source wins for primitives; deep-merge for objects).
 */
function mergeValue(target: ConfigValue, source: ConfigValue): ConfigValue {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return source;
  if (!target || typeof target !== 'object' || Array.isArray(target)) return source;
  const merged: ConfigRecord = { ...(target as ConfigRecord) };
  for (const [k, v] of mergeableEntries(source)) {
    merged[k] = mergeValue(merged[k], v);
  }
  return merged;
}

/**
 * Merges every entry of source onto a shallow copy of target.
 *
 * Iterates the source's own enumerable keys, except `__proto__`, deep-merging
 * each value via {@link mergeValue}. The target object is never mutated.
 *
 * @param target - Base config to copy and merge into.
 * @param source - Partial config whose values override or extend the target.
 * @returns A new ConfigRecord with source values merged on top of target.
 */
function mergeEntries(target: IImporterConfig, source: Partial<IImporterConfig>): ConfigRecord {
  const result: ConfigRecord = { ...target };
  for (const [key, srcVal] of mergeableEntries(source)) {
    result[key] = mergeValue(result[key], srcVal);
  }
  return result;
}

/**
 * Deep-merges source into target, returning a new merged IImporterConfig.
 *
 * Source values win over target for primitives and arrays. Plain objects
 * are merged recursively. The input objects are not mutated.
 *
 * @param target - Base config to merge into.
 * @param source - Partial config whose values override or extend the target.
 * @returns A new IImporterConfig with source values merged on top of target.
 */
export default function deepMerge(
  target: IImporterConfig,
  source: Partial<IImporterConfig>
): IImporterConfig {
  return mergeEntries(target, source) as unknown as IImporterConfig;
}
