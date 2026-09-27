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
import writeSpans from './MaskSpans.js';

/** What a masked value becomes: the same mark the key rule writes. */
const MASK = '[REDACTED]';

/**
 * The fewest characters a form of a value needs to be masked anywhere, even
 * inside a longer word. A shorter form could be an ordinary word's letters
 * or a number's digits, so it is masked only where it stands as a whole word.
 */
const ANYWHERE_LENGTH = 6;

/** A letter or a digit, the stuff a whole word is made of. */
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/** Asserts that no letter or digit stands right before. */
const NO_WORD_BEFORE = String.raw`(?<![\p{L}\p{N}])`;

/** Asserts that no letter or digit stands right after. */
const NO_WORD_AFTER = String.raw`(?![\p{L}\p{N}])`;

/** The characters a regex reads as syntax, escaped so a value matches as text. */
const REGEX_SYNTAX = /[\\^$.*+?()[\]{}|/]/g;

/**
 * A lone surrogate: one half of a pair, with no other half beside it. Under
 * the `u` flag a whole pair is one character, so only a lone half matches.
 */
const LONE_SURROGATE = /[\uD800-\uDFFF]/gu;

/** What UTF-8 writes for a lone surrogate, as a file or a URL encoder does. */
const REPLACEMENT_CHARACTER = '\uFFFD';

/** The code units a pair's first half can be: a high surrogate. */
const HIGH_HALF = { first: 0xd8_00, last: 0xdb_ff };

/** The code units a pair's second half can be: a low surrogate. */
const LOW_HALF = { first: 0xdc_00, last: 0xdf_ff };

/**
 * Lists the forms an output can write a value in: as it is, escaped inside a
 * JSON string, as a log line's text is, and percent-encoded in an address.
 *
 * <p>A value can hold a lone surrogate, as a JSON `\ud800` escape decodes to.
 * UTF-8 cannot hold one, so a file or a URL encoder writes U+FFFD in its
 * place, and that form is listed too. It is the one percent-encoded, as
 * `encodeURIComponent` throws on a lone surrogate.
 * @param value - One secret value.
 * @returns Its forms, or none for an empty value.
 */
function spellings(value: string): string[] {
  if (value.length === 0) return [];
  const json = JSON.stringify(value).slice(1, -1);
  const wellFormed = value.replaceAll(LONE_SURROGATE, REPLACEMENT_CHARACTER);
  const encoded = encodeURIComponent(wellFormed);
  return [value, wellFormed, json, encoded];
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
 * Builds the pattern source for one form of a value, or for the mask. A form
 * of six or more characters matches anywhere. A shorter one matches only as
 * a whole word: never right after a letter or digit when it starts with one,
 * nor right before one when it ends with one. So `test` is found in
 * `e2e-test-bank` but not in `e2eTestBank`.
 * @param spelling - One form of a value, or the mask.
 * @returns Its escaped text, bounded when it is short.
 */
function asSource(spelling: string): string {
  const literal = asPattern(spelling);
  if (spelling.length >= ANYWHERE_LENGTH) return literal;
  const first = spelling.at(0) ?? '';
  const last = spelling.at(-1) ?? '';
  const before = WORD_CHARACTER.test(first) ? NO_WORD_BEFORE : '';
  const after = WORD_CHARACTER.test(last) ? NO_WORD_AFTER : '';
  return `${before}${literal}${after}`;
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
 * Tells whether a form holds a lone surrogate. `search` always starts at the
 * text's start, whatever the global pattern's `lastIndex` is.
 * @param form - One form of a value.
 * @returns True when the form holds half of a pair with no other half.
 */
function holdsLoneHalf(form: string): boolean {
  return form.search(LONE_SURROGATE) >= 0;
}

/**
 * Builds the pattern that reads the text as whole characters, and finds the
 * mask or any known form that holds no lone surrogate.
 *
 * <p>The mask is one of the choices, so a mask already in the text is matched,
 * and written back, as a whole: a value that is part of it, such as `DACT`,
 * can never split it. It takes its place in the longest-first order, so a
 * value that starts with it, such as `[REDACTED]-x`, is matched whole. Letter
 * case is ignored, since a bank may quote a user name or address back upper-
 * or lower-cased. A form of a value that holds a lone surrogate, such as the
 * one with U+FFFD in its place, matches anywhere, whatever its length, as the
 * value's other forms do (see `byCodeUnit`).
 * @param forms - Every known form that holds no lone surrogate.
 * @param anywhere - The forms that match anywhere, whatever their length.
 * @returns A global, case-blind pattern matching the mask or any of them.
 */
function byCharacter(forms: readonly string[], anywhere: ReadonlySet<string>): RegExp {
  const sorted = [MASK, ...forms].sort(longestFirst);
  const sources = sorted.map((form) => (anywhere.has(form) ? asPattern(form) : asSource(form)));
  const source = sources.join('|');
  // Every value is escaped into a literal, so the pattern is an alternation
  // of plain text, some behind a one-character look-around, with no
  // quantifier: it cannot backtrack, and a test pins this.
  return new RegExp(source, 'giu'); // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
}

/**
 * Builds the pattern that reads the text code unit by code unit, and finds
 * the known forms that hold a lone surrogate.
 *
 * <p>Read as whole characters, a pair in the text is one character, so a lone
 * half at a form's edge never matches the same half inside a pair: `\uDE00x`
 * inside `😀x`. The whole-word look-arounds need whole characters, so these
 * forms match anywhere, whatever their length: they can hide a little more
 * than a whole word, never less.
 * @param forms - Every known form that holds a lone surrogate.
 * @returns A global, case-blind pattern matching any of them.
 */
function byCodeUnit(forms: readonly string[]): RegExp {
  const sorted = [...forms].sort(longestFirst);
  const sources = sorted.map(asPattern);
  const source = sources.join('|');
  // The same plain-text alternation as `byCharacter`, with no look-around.
  return new RegExp(source, 'gi'); // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
}

/**
 * Builds the patterns that find any known value, and any mask already there.
 * @param values - Every known form of every value.
 * @param anywhere - The forms that match anywhere, whatever their length:
 *   every form of a value that holds a lone surrogate.
 * @returns The whole-character pattern, then the code-unit one when a form
 *   holds a lone surrogate.
 */
function buildPatterns(values: ReadonlySet<string>, anywhere: ReadonlySet<string>): RegExp[] {
  const forms = [...values];
  const loneHalves = forms.filter(holdsLoneHalf);
  const whole = forms.filter((form) => !holdsLoneHalf(form));
  const characters = byCharacter(whole, anywhere);
  if (loneHalves.length === 0) return [characters];
  const codeUnits = byCodeUnit(loneHalves);
  return [characters, codeUnits];
}

/**
 * Finds where the search goes on after a match: one character past its start.
 * A character outside the Basic Multilingual Plane, such as an emoji, is two
 * code units, and is stepped over whole: a Unicode pattern moved into the
 * middle of one starts again at its first half, so it would find the same
 * match for ever.
 * @param text - The text being searched.
 * @param match - A match in it.
 * @returns The index just past the match's first character.
 */
function pastFirstCharacter(text: string, match: RegExpExecArray): number {
  const first = text.codePointAt(match.index) ?? 0;
  return match.index + String.fromCodePoint(first).length;
}

/**
 * Lists every match of one of the known values' patterns, however they
 * overlap.
 *
 * <p>Each search starts one character past the last match's start, not at its
 * end, so a value that starts inside an earlier match, as `echoed-Lk9` does in
 * `Qz7-echoed-Lk9`, is found too, and none of its characters is shown. The
 * code-unit pattern steps one code unit instead, so a form that starts at the
 * second half of the pair an earlier match starts in is found too. The spans
 * they make are joined where they overlap (see `MaskSpans`). Every match
 * holds at least one code unit, so the search always moves on.
 * @param text - Any text an output is about to write.
 * @param pattern - One of the known values' global patterns.
 * @returns The matches, by where they start.
 */
function everyMatchIn(text: string, pattern: RegExp): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    matches.push(match);
    pattern.lastIndex = pattern.unicode ? pastFirstCharacter(text, match) : match.index + 1;
  }
  return matches;
}

/**
 * Tells whether a code unit is within a range of surrogates.
 * @param unit - A code unit, or `NaN` past either end of the text.
 * @param range - The high or the low surrogates.
 * @returns True when the unit is in the range.
 */
function isIn(unit: number, range: typeof HIGH_HALF): boolean {
  return unit >= range.first && unit <= range.last;
}

/**
 * Tells whether an index falls between the two halves of a pair, where a
 * code-unit match can start or end.
 * @param text - The text being masked.
 * @param index - A place between two code units.
 * @returns True when a high half stands before it and a low half after it.
 */
function splitsPair(text: string, index: number): boolean {
  const before = text.charCodeAt(index - 1);
  const after = text.charCodeAt(index);
  return isIn(before, HIGH_HALF) && isIn(after, LOW_HALF);
}

/**
 * Turns one match of a known value into the span that masks it. A span that
 * would split a pair takes the whole pair, so the mask never leaves half of
 * a character behind.
 * @param text - The text the match was found in.
 * @param match - A match of one of the known values' patterns.
 * @returns The stretch it covers, written as the mask.
 */
function toMaskSpan(text: string, match: RegExpExecArray): IMaskSpan {
  const matchEnd = match.index + match[0].length;
  const start = splitsPair(text, match.index) ? match.index - 1 : match.index;
  const end = splitsPair(text, matchEnd) ? matchEnd + 1 : matchEnd;
  return { start, end, text: MASK };
}

/** A growing list of secret values, and the text masker they make. */
export class SecretValues {
  private readonly _values = new Set<string>();

  /** Every form of a value that holds a lone surrogate: they match anywhere. */
  private readonly _anywhere = new Set<string>();

  private _patterns = buildPatterns(this._values, this._anywhere);

  /**
   * Adds values to the list, in every form an output can write them.
   * @param values - Secret values, such as a bank's credentials.
   * @returns How many forms the list now holds.
   */
  public register(values: readonly string[]): number {
    const before = this._values.size;
    for (const spelling of values.flatMap(spellings)) this._values.add(spelling);
    const loneForms = values.filter(holdsLoneHalf).flatMap(spellings);
    for (const spelling of loneForms) this._anywhere.add(spelling);
    // A new value with a lone surrogate always adds its own text, which no
    // other value spells, so the list grows whenever `_anywhere` does.
    if (this._values.size !== before) this._patterns = buildPatterns(this._values, this._anywhere);
    return this._values.size;
  }

  /**
   * Finds every known value in a text, and any mask already there.
   * @param text - Any text an output is about to write.
   * @returns A span for each, which writes the mask. Spans can overlap, and
   *   `writeSpans` joins those that do.
   */
  public find(text: string): IMaskSpan[] {
    if (this._values.size === 0) return [];
    const matches = this._patterns.flatMap((pattern) => everyMatchIn(text, pattern));
    return matches.map((match) => toMaskSpan(text, match));
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
