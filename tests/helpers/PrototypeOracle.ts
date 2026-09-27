/**
 * Oracle for prototype pollution in parsed or copied config.
 *
 * <p>`JSON.parse` keeps a `"__proto__"` key as an ordinary own key, and any
 * later `out[key] = value` copy then sets `out`'s prototype to that value, so
 * the copy inherits fields no walk over own entries ever sees. A value is
 * clean when no object in it has such a key and each has its usual prototype.
 */

import { expect } from 'vitest';

/** The key a copy turns into a prototype. */
const POLLUTING_KEY = '__proto__';

/**
 * Lists the paths in a value that hold a `__proto__` key or an odd prototype.
 * @param value - The value to walk.
 * @param path - Where `value` sits, for the report.
 * @returns Every polluted path found.
 */
function pollutedPaths(value: unknown, path: string): string[] {
  if (typeof value !== 'object' || value === null) return [];
  const usual = Array.isArray(value) ? Array.prototype : Object.prototype;
  const own: string[] = [];
  if (Object.getPrototypeOf(value) !== usual) own.push(`${path} has a planted prototype`);
  if (Object.hasOwn(value, POLLUTING_KEY)) own.push(`${path} has an own ${POLLUTING_KEY} key`);
  const nested = Object.entries(value).flatMap(
    ([key, child]) => pollutedPaths(child, `${path}.${key}`),
  );
  return [...own, ...nested];
}

/**
 * Asserts that no object in a value carries a `__proto__` key or a planted prototype.
 * @param value - The parsed or copied config.
 */
export default function expectNoPollution(value: unknown): void {
  expect(pollutedPaths(value, '$')).toEqual([]);
}
