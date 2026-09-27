/**
 * Held values that overlap another match.
 *
 * <p>A held value can start inside the mask already in a text, start with the
 * mask itself, or overlap another held value. Each is found wherever it
 * starts, so none of its characters is shown, and the mask is still never
 * split by a value that is part of it.
 */
import { describe, expect, it } from 'vitest';

import type { IMaskSpan } from '../../src/Logger/MaskSpans.js';
import { SecretValues } from '../../src/Logger/SecretValues.js';
import fastestRunMs from '../helpers/fastestRunMs.js';

/** Text outside the values, which masking must keep. */
const CANARY = 'form-error-canary';

/** Far more than masking a long text takes, and far less than a rescan per character. */
const FAST_MS = 250;

/**
 * Builds a fresh list that knows the given values.
 * @param values - The values to register.
 * @returns The list.
 */
function knowing(...values: string[]): SecretValues {
  const known = new SecretValues();
  known.register(values);
  return known;
}

/**
 * Lists where a value starts in a text, overlapping starts too, in any letter case.
 * @param text - A text holding only ASCII, so lower-casing keeps every index.
 * @param value - One held value.
 * @returns Each index the value starts at.
 */
function startsOf(text: string, value: string): number[] {
  const haystack = text.toLowerCase();
  const needle = value.toLowerCase();
  const starts: number[] = [];
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    starts.push(at);
  }
  return starts;
}

/**
 * Tells whether every character of a stretch lies inside some span.
 * @param spans - The spans the masker found.
 * @param start - Where the stretch starts.
 * @param length - How long it is.
 * @returns True when no character of the stretch would be shown.
 */
function isHidden(spans: readonly IMaskSpan[], start: number, length: number): boolean {
  const indexes = Array.from({ length }, (_unused, offset) => start + offset);
  return indexes.every(index => spans.some(span => span.start <= index && index < span.end));
}

/** Values, and a text where they overlap each other or the mask. */
const OVERLAPS: readonly [string, readonly string[], string][] = [
  ['a value that starts with the mask', ['[REDACTED]-hunter2'], 'x [REDACTED]-hunter2 y'],
  ['a value that ends with the mask', ['hunter2-[REDACTED]'], 'x hunter2-[REDACTED] y'],
  ['a value that starts inside a mask already there', ['D]hunter2x'], 'x [REDACTED]hunter2x y'],
  ['two values that overlap', ['Qz7-echoed', 'echoed-Lk9'], 'x Qz7-echoed-Lk9 y'],
  ['a chain of three values', ['abcdef', 'cdefgh', 'efghij'], 'x abcdefghij y'],
  ['a value that overlaps itself', ['aaaaaa'], 'x aaaaaaaaaaa y'],
  ['overlapping values in another case', ['Qz7-Echoed', 'ECHOED-lk9'], 'x qz7-echoed-LK9 y'],
];

describe('SecretValues with a held value that overlaps another match', () => {
  it.each(OVERLAPS)('hides every character of %s', (_case, values, text) => {
    const spans = knowing(...values).find(text);
    for (const value of values) {
      for (const start of startsOf(text, value)) expect(isHidden(spans, start, value.length)).toBe(true);
    }
  });

  it.each(OVERLAPS)('writes one mask over %s', (_case, values, text) => {
    expect(knowing(...values).mask(text)).toBe('x [REDACTED] y');
  });

  it('hides a value that starts with an emoji, and every copy of it', () => {
    const masked = knowing('😀-secret').mask(`a 😀-secret 😀-secret 😀 ${CANARY}`);
    expect(masked).toBe(`a [REDACTED] [REDACTED] 😀 ${CANARY}`);
  });

  it('keeps the mask whole when a value is part of it and another starts inside it', () => {
    const masked = knowing('DACT', 'D]tail7').mask(`[REDACTED] [REDACTED]tail7 ${CANARY}`);
    expect(masked).toBe(`[REDACTED] [REDACTED] ${CANARY}`);
  });

  it('masks a long run of one overlapping value fast', () => {
    const text = `${'a'.repeat(20_000)} ${CANARY}`;
    const known = knowing('aaaaaa');
    expect(known.mask(text)).toBe(`[REDACTED] ${CANARY}`);
    expect(fastestRunMs(() => known.mask(text), FAST_MS)).toBeLessThan(FAST_MS);
  });
});
