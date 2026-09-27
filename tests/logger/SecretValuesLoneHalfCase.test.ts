/**
 * A held value with a lone surrogate at its edge, quoted back in another
 * letter case.
 *
 * <p>Every form of every value ignores letter case the way the `u` flag folds
 * it, so `ſ` and `S`, or the Kelvin sign and `k`, are the same letter. A lone
 * half at a value's edge can stand alone in the text or be one half of a
 * pair, and the value is found in any letter case either way. Kept in its own
 * file: the values it registers stay in the process-wide list for the rest of
 * the file.
 */
import { describe, expect, it } from 'vitest';

import redactSecrets from '../../src/Logger/SecretRedaction.js';
import { registerSecretValues, SecretValues } from '../../src/Logger/SecretValues.js';

/** Text outside the value, which masking must keep. */
const CANARY = 'form-error-canary';

/**
 * Letters that are the same once case is folded, as the `u` flag folds it,
 * but that plain upper- or lower-casing does not turn into each other: why
 * they are held, then the held letter, then the one the text holds.
 */
const SAME_LETTERS: readonly (readonly [string, string, string])[] = [
  ['long s held, capital S written', '\u017F', 'S'],
  ['s held, long s written', 's', '\u017F'],
  ['k held, Kelvin sign written', 'k', '\u212A'],
  ['Kelvin sign held, capital K written', '\u212A', 'K'],
  ['omega held, ohm sign written', '\u03C9', '\u2126'],
  ['sharp s held, capital sharp s written', '\u00DF', '\u1E9E'],
  ['a with ring held, angstrom sign written', '\u00E5', '\u212B'],
];

/** The two halves of one character: a high half, then a low half. */
interface IHalves {
  readonly high: string;
  readonly low: string;
}

/** Builds a held value, or the text that quotes it, around one letter. */
type Around = (letter: string, halves: IHalves) => string;

/** Where a value's lone half stands in the text: alone, or in a pair. */
const EDGES: readonly (readonly [string, Around, Around])[] = [
  ['after the high half of a pair', (letter, { low }) => `${low}${letter}`, (letter, { high, low }) => `${high}${low}${letter}`],
  ['after nothing it pairs with', (letter, { low }) => `${low}${letter}`, (letter, { low }) => `${low}${letter}`],
  ['before the low half of a pair', (letter, { high }) => `${letter}${high}`, (letter, { high, low }) => `${letter}${high}${low}`],
  ['before nothing it pairs with', (letter, { high }) => `${letter}${high}`, (letter, { high }) => `${letter}${high}`],
];

/**
 * Picks different halves for each letter, so that, when every value is held
 * at once, no held value matches the text another case quotes.
 * @param row - The letter's place in the list.
 * @returns The halves of one character, such as the emoji 😀 for the first.
 */
function halvesFor(row: number): IHalves {
  return { high: String.fromCodePoint(0xd8_3d - row), low: String.fromCodePoint(0xde_00 + row) };
}

/** Each case: its name, the held value, and the text that quotes it. */
const CASES = SAME_LETTERS.flatMap(([letters, held, written], row) =>
  EDGES.map(([edge, toValue, toText]) => {
    const halves = halvesFor(row);
    return [`${letters}, lone half ${edge}`, toValue(held, halves), toText(written, halves)] as const;
  }),
);

describe('the letters these tests hold', () => {
  it.each(SAME_LETTERS)('%s: the same letter only once case is folded', (_letters, held, written) => {
    expect(new RegExp(`^${held}$`, 'iu').test(written)).toBe(true);
    expect(new RegExp(`^${held}$`, 'i').test(written)).toBe(false);
  });
});

describe('SecretValues with a held value quoted back in another letter case', () => {
  it.each(CASES)('hides it: %s', (_case, value, written) => {
    const known = new SecretValues();
    known.register([value]);

    expect(known.mask(`${CANARY} ${written} ${CANARY}`)).toBe(`${CANARY} [REDACTED] ${CANARY}`);
  });
});

describe('redactSecrets with a held value quoted back in another letter case', () => {
  registerSecretValues(CASES.map(([, value]) => value));

  it.each(CASES)('hides it: %s', (_case, _value, written) => {
    expect(redactSecrets(`${CANARY} ${written} ${CANARY}`)).toBe(`${CANARY} [REDACTED] ${CANARY}`);
  });
});
