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

/** How many pairs hold one given half: one for each half it can pair with. */
const PAIRS_PER_HALF = 0x4_00;

/** The first code point a pair makes, from the first high and low halves. */
const FIRST_PAIRED = 0x1_00_00;

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
 * Tells whether a code unit is within a range of surrogates.
 * @param unit - A code unit, or `NaN` outside an empty form.
 * @param range - The high or the low surrogates.
 * @returns True when the unit is in the range.
 */
function isIn(unit: number, range: typeof HIGH_HALF): boolean {
  return unit >= range.first && unit <= range.last;
}

/**
 * Tells whether a form starts with a low half: one a pair in the text can end.
 * @param form - One form of a value, or the mask.
 * @returns True when its first code unit is a low surrogate.
 */
function startsWithLowHalf(form: string): boolean {
  const first = form.charCodeAt(0);
  return isIn(first, LOW_HALF);
}

/**
 * Tells whether a form ends with a high half: one a pair in the text can start.
 * @param form - One form of a value, or the mask.
 * @returns True when its last code unit is a high surrogate.
 */
function endsWithHighHalf(form: string): boolean {
  const last = form.charCodeAt(form.length - 1);
  return isIn(last, HIGH_HALF);
}

/**
 * Counts a form's characters: a pair of halves is one, and so is a lone half.
 * @param form - One form of a value, or the mask.
 * @returns How many characters it holds.
 */
function characterCount(form: string): number {
  return Array.from(form).length;
}

/**
 * Orders values by how many characters they hold, most first, so one holding
 * another is masked whole. A match always covers whole characters, and a lone
 * half at a form's edge covers one whether the text pairs it or not (see
 * `asLoneSource`). So of two forms that match at the same place, the one with
 * more characters reaches further, even when it has no more code units:
 * `\uDE00abcde` covers one more than `😀abcd` in `😀abcde`.
 * @param left - One value.
 * @param right - Another value.
 * @returns A negative number when the left value holds more characters.
 */
function mostCharactersFirst(left: string, right: string): number {
  return characterCount(right) - characterCount(left);
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
 * Writes one code point as a pattern escape, which the `u` flag reads as that
 * code point, a lone surrogate included.
 * @param point - A code point.
 * @returns Its escape.
 */
function asEscape(point: number): string {
  return String.raw`\u{${point.toString(16)}}`;
}

/**
 * Builds the pattern source for a low half at a form's start: the half alone,
 * or any of the pairs that end in it.
 * @param low - A low surrogate.
 * @returns The source, as one group.
 */
function orPairsEndingIn(low: number): string {
  const offset = low - LOW_HALF.first;
  const highs = Array.from({ length: PAIRS_PER_HALF }, (_, high) => high);
  const points = highs.map((high) => FIRST_PAIRED + high * PAIRS_PER_HALF + offset);
  const pairs = points.map(asEscape).join('');
  return `(?:[${pairs}]|${asEscape(low)})`;
}

/**
 * Builds the pattern source for a high half at a form's end: the half alone,
 * or any of the pairs that start with it.
 * @param high - A high surrogate.
 * @returns The source, as one group.
 */
function orPairsStartingWith(high: number): string {
  const first = FIRST_PAIRED + (high - HIGH_HALF.first) * PAIRS_PER_HALF;
  const last = first + PAIRS_PER_HALF - 1;
  return `(?:[${asEscape(first)}-${asEscape(last)}]|${asEscape(high)})`;
}

/**
 * Builds the pattern source for a form that holds a lone surrogate. It matches
 * anywhere, whatever its length, and ignores letter case as every other form
 * does.
 *
 * <p>Under the `u` flag a pair in the text is one character, so a match never
 * starts or ends between its halves: a low half at a form's start, alone,
 * never matches inside `😀x`, and a high half at its end never matches inside
 * `x😀`. So such a half is matched alone or as any pair that holds it, and the
 * whole pair is masked. A lone half anywhere else in a form has the form's
 * own code units on both sides, so the text cannot pair it.
 * @param form - One form of a value that holds a lone surrogate.
 * @returns Its escaped text, with a group for each lone half at its edge.
 */
function asLoneSource(form: string): string {
  const first = form.charCodeAt(0);
  const last = form.charCodeAt(form.length - 1);
  const before = startsWithLowHalf(form) ? orPairsEndingIn(first) : '';
  const after = endsWithHighHalf(form) ? orPairsStartingWith(last) : '';
  const middle = form.slice(before === '' ? 0 : 1, after === '' ? form.length : -1);
  return `${before}${asPattern(middle)}${after}`;
}

/**
 * Builds the pattern source for one form of a value, or for the mask.
 * @param form - One form of a value, or the mask.
 * @param anywhere - The forms that match anywhere, whatever their length.
 * @returns Its source.
 */
function sourceOf(form: string, anywhere: ReadonlySet<string>): string {
  if (holdsLoneHalf(form)) return asLoneSource(form);
  if (anywhere.has(form)) return asPattern(form);
  return asSource(form);
}

/**
 * Builds the pattern that finds the mask or any known form of a value.
 *
 * <p>The mask is one of the choices, so a mask already in the text is matched,
 * and written back, as a whole: a value that is part of it, such as `DACT`,
 * can never split it. It takes its place in the most-characters-first order,
 * so a value that starts with it, such as `[REDACTED]-x`, is matched whole.
 * Letter case is ignored, as the `u` flag folds it, since a bank may quote a
 * user name or address back upper- or lower-cased. Every form of a value that
 * holds a lone surrogate, such as the one with U+FFFD in its place, matches
 * anywhere, whatever its length.
 * @param values - Every known form of every value.
 * @param anywhere - The forms that match anywhere, whatever their length:
 *   every form of a value that holds a lone surrogate.
 * @returns A global, case-blind pattern matching the mask or any of them.
 */
function buildPattern(values: ReadonlySet<string>, anywhere: ReadonlySet<string>): RegExp {
  const sorted = [MASK, ...values].sort(mostCharactersFirst);
  const sources = sorted.map((form) => sourceOf(form, anywhere));
  const source = sources.join('|');
  // Every value is escaped into a literal, so the pattern is an alternation
  // of plain text, some behind a one-character look-around or beside a group
  // of single characters, with no quantifier: it cannot backtrack, and a test
  // pins this.
  return new RegExp(source, 'giu'); // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
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
 * Lists every match of the known values' pattern, however they overlap.
 *
 * <p>Each search starts one character past the last match's start, not at its
 * end, so a value that starts inside an earlier match, as `echoed-Lk9` does in
 * `Qz7-echoed-Lk9`, is found too, and none of its characters is shown. The
 * spans they make are joined where they overlap (see `MaskSpans`). Every
 * match holds at least one character, so the search always moves on.
 * @param text - Any text an output is about to write.
 * @param pattern - The known values' global pattern.
 * @returns The matches, by where they start.
 */
function everyMatchIn(text: string, pattern: RegExp): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    matches.push(match);
    pattern.lastIndex = pastFirstCharacter(text, match);
  }
  return matches;
}

/**
 * Turns one match of a known value into the span that masks it.
 * @param match - A match of the known values' pattern.
 * @returns The stretch it covers, written as the mask.
 */
function toMaskSpan(match: RegExpExecArray): IMaskSpan {
  return { start: match.index, end: match.index + match[0].length, text: MASK };
}

/** A growing list of secret values, and the text masker they make. */
export class SecretValues {
  private readonly _values = new Set<string>();

  /** Every form of a value that holds a lone surrogate: they match anywhere. */
  private readonly _anywhere = new Set<string>();

  private _pattern = buildPattern(this._values, this._anywhere);

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
    if (this._values.size !== before) this._pattern = buildPattern(this._values, this._anywhere);
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
    const matches = everyMatchIn(text, this._pattern);
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
