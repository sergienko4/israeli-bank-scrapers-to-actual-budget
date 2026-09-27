/**
 * Parses JSON without any `__proto__` key, at every level.
 *
 * <p>`JSON.parse` keeps a `"__proto__"` key as an ordinary own key. Any later
 * `out[key] = value` copy of the result then sets `out`'s prototype to that
 * value, so the copy inherits fields that no walk over its own entries sees.
 * The config readers parse through this, so no copy of the config (the merge,
 * the secret split, the portal's masking) can meet the key. It sits beside
 * {@link POLLUTING_KEY}, the key it leaves out.
 * @module
 */

import { POLLUTING_KEY } from './StoreRecords.js';

/**
 * Copies parsed JSON, leaving out every `__proto__` key at every level.
 * @param value - A value `JSON.parse` returned.
 * @returns The same data without any `__proto__` key.
 */
function withoutPollutingKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item: unknown) => withoutPollutingKeys(item));
  if (typeof value !== 'object' || value === null) return value;
  const kept = Object.entries(value).filter(([key]) => key !== POLLUTING_KEY);
  const copied = kept.map(([key, child]) => [key, withoutPollutingKeys(child)]);
  return Object.fromEntries(copied);
}

/**
 * Parses JSON, leaving out every `__proto__` key at every level.
 * @param text - JSON text, such as a config file or a decrypted one.
 * @returns The parsed data without any `__proto__` key.
 * @throws SyntaxError when the text is not JSON.
 */
export default function parseProtoFreeJson(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  return withoutPollutingKeys(parsed);
}
