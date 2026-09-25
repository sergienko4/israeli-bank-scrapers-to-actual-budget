/**
 * The secret values this process holds, masked wherever they appear.
 *
 * <p>The key rule in `SecretRedaction` hides a value only after a secret key.
 * A bank can quote a credential back with no key at all — the visible text of
 * its login form's error reaches the provider's message word for word — so
 * the values the importer was given are masked as text too. They are
 * registered where they enter the process, and every output that masks text
 * then hides them, in records an older release wrote as well.
 *
 * <p>The list is process-wide and only ever grows, as the log level that
 * `applyConfiguredLogLevel` publishes is: threading it through every output
 * instead would put a masker into each one's wiring.
 */

import type { IMaskSpan } from './MaskSpans.js';
import writeSpans, { matchesIn } from './MaskSpans.js';

/** What a masked value becomes: the same mark the key rule writes. */
const MASK = '[REDACTED]';

/**
 * The fewest characters a value needs to be masked as bare text. A shorter
 * one would hide that run of characters in every line it occurs in, and the
 * key rule still hides it after its key.
 */
const MIN_LENGTH = 4;

/** The characters a regex reads as syntax, escaped so a value matches as text. */
const REGEX_SYNTAX = /[\\^$.*+?()[\]{}|/]/g;

/**
 * Lists the forms an output can write a value in: as it is, escaped inside a
 * JSON string, as a log line's text is, and percent-encoded in an address.
 * @param value - One secret value.
 * @returns Its forms, or none for a value too short to mask as text.
 */
function spellings(value: string): string[] {
  if (value.length < MIN_LENGTH) return [];
  const json = JSON.stringify(value).slice(1, -1);
  const encoded = encodeURIComponent(value);
  return [value, json, encoded];
}

/**
 * Escapes a value's regex syntax, so the pattern matches its exact text.
 * @param text - A value, or the mask.
 * @returns The text as a pattern source.
 */
function asPattern(text: string): string {
  return text.replaceAll(REGEX_SYNTAX, String.raw`\$&`);
}

/**
 * Orders values longest first, so one holding another is masked whole.
 * @param left - One value.
 * @param right - Another value.
 * @returns A negative number when the left value is the longer.
 */
function longestFirst(left: string, right: string): number {
  return right.length - left.length;
}

/**
 * Builds the pattern that finds any known value.
 *
 * <p>The mask comes first, so a mask already in the text is matched, and
 * written back, as a whole: a value that is part of it, such as `DACT`, can
 * never split it, and masking a masked text again changes nothing. Letter
 * case is ignored, since a bank may quote a user name or address back upper-
 * or lower-cased.
 * @param values - Every known form of every value.
 * @returns A global, case-blind pattern matching the mask or any value.
 */
function buildPattern(values: ReadonlySet<string>): RegExp {
  const sorted = [...values].sort(longestFirst);
  const sources = [MASK, ...sorted].map(asPattern);
  const source = sources.join('|');
  return new RegExp(source, 'gi');
}

/**
 * Turns one match of a known value into the span that masks it.
 * @param match - A match of the known values' pattern.
 * @returns The stretch it covers, written as the mask.
 */
function toMaskSpan(match: RegExpExecArray): IMaskSpan {
  const start = match.index;
  return { start, end: start + match[0].length, text: MASK };
}

/** A growing list of secret values, and the text masker they make. */
export class SecretValues {
  private readonly _values = new Set<string>();

  private _pattern = buildPattern(this._values);

  /**
   * Adds values to the list, in every form an output can write them.
   * @param values - Secret values, such as a bank's credentials.
   * @returns How many forms the list now holds.
   */
  public register(values: readonly string[]): number {
    const before = this._values.size;
    for (const spelling of values.flatMap(spellings)) this._values.add(spelling);
    if (this._values.size !== before) this._pattern = buildPattern(this._values);
    return this._values.size;
  }

  /**
   * Finds every known value in a text, and any mask already there.
   * @param text - Any text an output is about to write.
   * @returns A span for each, which writes the mask.
   */
  public find(text: string): IMaskSpan[] {
    if (this._values.size === 0) return [];
    const matches = matchesIn(text, this._pattern);
    return matches.map(toMaskSpan);
  }

  /**
   * Replaces every known value in a text with the mask.
   * @param text - Any text an output is about to write.
   * @returns The text with each known value masked.
   */
  public mask(text: string): string {
    const spans = this.find(text);
    return writeSpans(text, spans);
  }
}

/** The values this process holds, which every output's masking shares. */
const PROCESS_VALUES = new SecretValues();

/**
 * Registers secret values this process holds, so no output shows them.
 * @param values - Secret values, such as a bank's credentials.
 * @returns How many forms the process now masks.
 */
export function registerSecretValues(values: readonly string[]): number {
  return PROCESS_VALUES.register(values);
}

/**
 * Finds every secret value this process holds in a text.
 * @param text - Any text an output is about to write.
 * @returns A span for each, which writes the mask.
 */
export function findSecretValues(text: string): IMaskSpan[] {
  return PROCESS_VALUES.find(text);
}
