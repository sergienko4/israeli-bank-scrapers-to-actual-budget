import { describe, expect, it } from 'vitest';

import type { IMaskSpan } from '../../src/Logger/MaskSpans.js';
import writeSpans, { matchesIn } from '../../src/Logger/MaskSpans.js';

/** A text whose characters name their own positions, so a wrong cut shows. */
const TEXT = '0123456789abcdef';

/**
 * Builds a span that writes the given text.
 * @param start - Where it starts.
 * @param end - Where it ends.
 * @param text - What it writes.
 * @returns The span.
 */
function span(start: number, end: number, text: string): IMaskSpan {
  return { start, end, text };
}

describe('writeSpans', () => {
  it('returns the text unchanged when there are no spans', () => {
    expect(writeSpans(TEXT, [])).toBe(TEXT);
  });

  it('replaces each span with its text, in text order, whatever order they come in', () => {
    const out = writeSpans(TEXT, [span(10, 12, 'B'), span(2, 4, 'A')]);

    expect(out).toBe('01A456789Bcdef');
  });

  it('replaces a span at the start and one at the end', () => {
    expect(writeSpans(TEXT, [span(0, 2, '<'), span(14, 16, '>')])).toBe('<23456789abcd>');
  });

  it('writes two spans that touch one after the other', () => {
    expect(writeSpans(TEXT, [span(2, 4, 'A'), span(4, 6, 'B')])).toBe('01AB6789abcdef');
  });

  it('writes overlapping spans as the one that starts first, covering both', () => {
    const out = writeSpans(TEXT, [span(4, 9, 'B'), span(2, 6, 'A')]);

    expect(out).toBe('01A9abcdef');
  });

  it('writes a span that another holds as the outer one alone', () => {
    expect(writeSpans(TEXT, [span(2, 10, 'A'), span(4, 6, 'B')])).toBe('01Aabcdef');
  });

  it('writes a chain of overlapping spans as the first one, to the last one\'s end', () => {
    const out = writeSpans(TEXT, [span(2, 5, 'A'), span(4, 8, 'B'), span(7, 11, 'C')]);

    expect(out).toBe('01Abcdef');
  });

  it('writes the span given first when two start at the same place', () => {
    expect(writeSpans(TEXT, [span(2, 4, 'A'), span(2, 6, 'B')])).toBe('01A6789abcdef');
    expect(writeSpans(TEXT, [span(2, 6, 'B'), span(2, 4, 'A')])).toBe('01B6789abcdef');
  });
});

describe('matchesIn', () => {
  it('lists every match in text order, with where each starts', () => {
    const found = matchesIn('a1b22c333', /\d+/g).map(match => [match.index, match[0]]);

    expect(found).toEqual([[1, '1'], [3, '22'], [6, '333']]);
  });

  it('finds nothing in a text with no match', () => {
    expect(matchesIn('abc', /\d+/g)).toEqual([]);
  });

  it('starts from the beginning whatever a previous search left behind', () => {
    const pattern = /\d/g;
    pattern.lastIndex = 5;

    expect(matchesIn('1a2', pattern)).toHaveLength(2);
    expect(pattern.lastIndex).toBe(0);
  });

  it('steps past an empty match instead of repeating it', () => {
    expect(matchesIn('ab', /x*/g)).toHaveLength(3);
  });
});
