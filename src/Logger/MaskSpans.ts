/**
 * Builds a masked text from the stretches that each masking rule found.
 *
 * <p>Each rule finds its stretches in the original text, so neither can hide
 * what the other must see: a held value that is part of a secret key, as
 * `secret` is of `client_secret`, cannot erase the key before the key rule
 * reads it. Where two stretches overlap, the one that starts first is written
 * and covers both, so no character of either is shown.
 */

/** One stretch of a text to replace, and what to write in its place. */
export interface IMaskSpan {
  /** Where the stretch starts, as an index into the text. */
  readonly start: number;
  /** Where the stretch ends, one past its last character. */
  readonly end: number;
  /** What is written in its place. */
  readonly text: string;
}

/**
 * Orders spans by where they start. The sort is stable, so of two that start
 * at the same place, the one given first stays first.
 * @param left - One span.
 * @param right - Another span.
 * @returns A negative number when the left span starts first.
 */
function byStart(left: IMaskSpan, right: IMaskSpan): number {
  return left.start - right.start;
}

/**
 * Joins each run of overlapping spans into the one that starts it, stretched
 * to the run's end. Spans that only touch stay apart.
 * @param spans - The spans, in any order.
 * @returns The spans to write, in text order and apart from each other.
 */
function leadingSpans(spans: readonly IMaskSpan[]): IMaskSpan[] {
  const sorted = [...spans].sort(byStart);
  const kept: IMaskSpan[] = [];
  for (const span of sorted) {
    const last = kept.at(-1);
    if (last === undefined || span.start >= last.end) kept.push(span);
    else kept[kept.length - 1] = { ...last, end: Math.max(last.end, span.end) };
  }
  return kept;
}

/**
 * Lists every match of a global pattern in a text.
 *
 * <p>Reads the pattern with `exec`, as `matchAll` copies the pattern on each
 * call: the masker runs on every log line, and its patterns are large. The
 * search starts at the beginning, and `exec` leaves `lastIndex` at 0 once it
 * finds no more. An empty match is stepped past, so it cannot repeat forever.
 * @param text - The text to search.
 * @param pattern - A global pattern.
 * @returns The matches, in text order.
 */
export function matchesIn(text: string, pattern: RegExp): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    matches.push(match);
    if (match[0] === '') pattern.lastIndex += 1;
  }
  return matches;
}

/**
 * Replaces each stretch of a text with what its span writes.
 * @param text - The text the spans were found in.
 * @param spans - The stretches to replace, in any order.
 * @returns The text with every stretch replaced.
 */
export default function writeSpans(text: string, spans: readonly IMaskSpan[]): string {
  const parts: string[] = [];
  let cursor = 0;
  for (const span of leadingSpans(spans)) {
    const before = text.slice(cursor, span.start);
    parts.push(before, span.text);
    cursor = span.end;
  }
  const rest = text.slice(cursor);
  parts.push(rest);
  return parts.join('');
}
