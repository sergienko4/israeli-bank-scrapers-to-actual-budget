/**
 * An invariant over generated values and texts: no code unit of a held value
 * that holds a lone surrogate is ever shown, in any letter case, however the
 * values overlap each other or pair with the text beside them.
 *
 * <p>The oracle does not use the masker's patterns. It compares code unit by
 * code unit: a half of a pair only with itself, and a letter with any letter
 * of its group, the letters the `u` flag folds together. Kept in its own
 * file: the values it registers stay in the process-wide list for the rest of
 * the file.
 */
import { faker } from '@faker-js/faker';
import { describe, expect, it } from 'vitest';

import type { IMaskSpan } from '../../src/Logger/MaskSpans.js';
import redactSecrets from '../../src/Logger/SecretRedaction.js';
import { registerSecretValues, SecretValues } from '../../src/Logger/SecretValues.js';

/** Letters in groups the `u` flag folds together, and one that folds with none. */
const LETTER_GROUPS: readonly (readonly string[])[] = [['s', 'S', '\u017F'], ['k', 'K', '\u212A'], ['z']];

/** Halves of pairs: a high half then a low half make one character. */
const HALVES = ['\uD83D', '\uD83E', '\uDE00', '\uDE01'];

/** Every code unit the generated values and texts are made of. */
const UNITS = [...LETTER_GROUPS.flat(), ...HALVES];

/** Each letter's group. */
const GROUP_OF = new Map(LETTER_GROUPS.flatMap(group => group.map(letter => [letter, group] as const)));

/** The seed, so every run tries the same cases. */
const SEED = 20_260_927;

/** How many values are held at once. */
const VALUE_COUNT = 40;

/** How many texts are masked. */
const TEXT_COUNT = 2000;

/**
 * Builds a run of random code units.
 * @param max - The most units it can hold; it holds at least one.
 * @returns The run.
 */
function randomUnits(max: number): string {
  const length = faker.number.int({ min: 1, max });
  return faker.helpers.multiple(() => faker.helpers.arrayElement(UNITS), { count: length }).join('');
}

/**
 * Builds a random value that holds a lone half, so each of its forms is
 * matched anywhere.
 * @returns The value.
 */
function randomValue(): string {
  const value = randomUnits(4);
  return /[\uD800-\uDFFF]/u.test(value) ? value : randomValue();
}

/**
 * Writes a value with each letter swapped for a random one of its group.
 * @param value - A held value.
 * @returns The value in a random letter case.
 */
function inAnyCase(value: string): string {
  const units = value.split('').map(unit => faker.helpers.arrayElement(GROUP_OF.get(unit) ?? [unit]));
  return units.join('');
}

/**
 * Builds a random text of random units and held values, in any letter case.
 * @param values - The held values.
 * @returns The text.
 */
function randomText(values: readonly string[]): string {
  const count = faker.number.int({ min: 1, max: 4 });
  const pieces = faker.helpers.multiple(
    () => (faker.datatype.boolean() ? randomUnits(3) : inAnyCase(faker.helpers.arrayElement(values))),
    { count },
  );
  return pieces.join('');
}

/**
 * Tells whether a text's unit is the held unit, in any letter case.
 * @param held - A code unit of a held value.
 * @param written - The code unit in the text, if any.
 * @returns True when they are the same.
 */
function sameUnit(held: string, written: string | undefined): boolean {
  return held === written || (GROUP_OF.get(held) ?? []).some(letter => letter === written);
}

/**
 * Lists where a held value stands in a text, code unit by code unit.
 * @param value - A held value.
 * @param text - A text.
 * @returns The index of each place it starts.
 */
function startsOf(value: string, text: string): number[] {
  const units = value.split('');
  const places = Array.from({ length: text.length - value.length + 1 }, (_, start) => start);
  return places.filter(start => units.every((unit, offset) => sameUnit(unit, text[start + offset])));
}

/**
 * Lists every unit of a held value in a text that no span covers.
 * @param text - A text.
 * @param values - The held values.
 * @param spans - The spans the masker found.
 * @returns A line for each unit shown.
 */
function shownUnits(text: string, values: readonly string[], spans: readonly IMaskSpan[]): string[] {
  const places = values.flatMap(value => startsOf(value, text).map(start => ({ value, start })));
  const units = places.flatMap(({ value, start }) => value.split('').map((_, offset) => ({ value, at: start + offset })));
  const shown = units.filter(({ at }) => !spans.some(span => span.start <= at && at < span.end));
  return shown.map(({ value, at }) => JSON.stringify({ text, value, at }));
}

/**
 * Tells whether an index falls between the two halves of a pair.
 * @param text - A text.
 * @param index - A place between two code units.
 * @returns True when a high half stands before it and a low half after it.
 */
function splitsPair(text: string, index: number): boolean {
  return /[\uD800-\uDBFF]/.test(text.charAt(index - 1)) && /[\uDC00-\uDFFF]/.test(text.charAt(index));
}

describe('the letter groups the oracle uses', () => {
  it.each(LETTER_GROUPS.flatMap(group => group.map(letter => [letter, group] as const)))(
    '%s folds together with its group and with no other letter',
    (letter, group) => {
      const folds = new RegExp(`^${letter}$`, 'iu');
      const others = LETTER_GROUPS.flat().filter(other => !group.includes(other));

      expect(group.every(member => folds.test(member))).toBe(true);
      expect(others.some(other => folds.test(other))).toBe(false);
    },
  );
});

describe('SecretValues with generated values that hold a lone half', () => {
  faker.seed(SEED);
  const values = [...new Set(Array.from({ length: VALUE_COUNT }, randomValue))];
  const texts = Array.from({ length: TEXT_COUNT }, () => randomText(values));
  const known = new SecretValues();
  known.register(values);
  registerSecretValues(values);

  it('tries held values in other letter cases, and lone halves that pair with the text', () => {
    const places = texts.flatMap(text => values.flatMap(value => startsOf(value, text).map(start => ({ text, value, start }))));
    const inOtherCase = places.filter(({ text, value, start }) => text.slice(start, start + value.length) !== value);
    const paired = places.filter(({ text, value, start }) => splitsPair(text, start) || splitsPair(text, start + value.length));

    expect(inOtherCase.length).toBeGreaterThan(100);
    expect(paired.length).toBeGreaterThan(100);
  });

  it('shows no unit of any held value', () => {
    const shown = texts.flatMap(text => shownUnits(text, values, known.find(text)));

    expect(shown).toEqual([]);
  });

  it('never leaves half of a pair outside the mask', () => {
    const splits = texts.flatMap(text =>
      known
        .find(text)
        .filter(span => splitsPair(text, span.start) || splitsPair(text, span.end))
        .map(span => JSON.stringify({ text, span })),
    );

    expect(splits).toEqual([]);
  });

  it('writes the same text through the process-wide masking', () => {
    const differ = texts.filter(text => redactSecrets(text) !== known.mask(text));

    expect(differ).toEqual([]);
  });
});
