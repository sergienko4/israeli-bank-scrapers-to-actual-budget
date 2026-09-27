/**
 * Known secret values.
 *
 * <p>A bank can quote a credential back with no key in front of it, as the
 * visible text of a login form's error. The key rule cannot see such a value,
 * so the values the importer itself holds are masked wherever they appear,
 * in each form an output can write them.
 */
import { describe, expect, it } from 'vitest';

import { SecretValues } from '../../src/Logger/SecretValues.js';
import fastestRunMs from '../helpers/fastestRunMs.js';

/** A credential the bank may quote back. */
const VALUE = 'Qz7-echoed-Lk9';

/** Text outside the value, which masking must keep. */
const CANARY = 'form-error-canary';

/** A value that would backtrack for ever on a run of `b`s if read as a pattern. */
const BACKTRACKING = '(b+)+$';

/** Far more than masking one short line takes, and far less than backtracking. */
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

/** What a masked value becomes. */
const MASK = '[REDACTED]';

/** Where a quoted credential can sit in a bank's words, for any value. */
const PLACED: readonly [string, (value: string) => string][] = [
  ['the first word', value => `${value} ${CANARY}`],
  ['mid-sentence', value => `Form: user ${value} is not valid ${CANARY}`],
  ['the last word', value => `${CANARY} ${value}`],
  ['twice', value => `${value} ${CANARY} ${value}`],
  ['between punctuation', value => `${CANARY} (${value}).`],
  ['inside quotes', value => `${CANARY} "${value}"`],
  ['inside an address', value => `GET https://bank.example/login?user=${value}&x=1 ${CANARY}`],
  ['with no space around it', value => `${CANARY}:${value}:${CANARY}`],
];

/** Each placement, with the long value in it. */
const PLACEMENTS: readonly [string, string][] = PLACED.map(([placement, place]) => [placement, place(VALUE)]);

/** Values under six characters, which are masked only where they stand as a whole word. */
const SHORT_VALUES = ['k', 'k9', 'k9Q', 'k9Qa', 'k9Qab', '123', 'דני'];

/** Each short value in each placement, and the text masking must write for it. */
const SHORT_CASES = SHORT_VALUES.flatMap(value =>
  PLACED.map(([placement, place]) => [value, placement, place(value), place(MASK)] as const));

describe('SecretValues', () => {
  it.each(PLACEMENTS)('hides a known value as %s', (_placement, text) => {
    const masked = knowing(VALUE).mask(text);
    expect(masked).not.toContain(VALUE);
    expect(masked).toContain('[REDACTED]');
    expect(masked).toContain(CANARY);
  });

  it('hides a value the way a JSON text escapes it', () => {
    const quoted = 'Qz7"echoed\\Lk9';
    const line = JSON.stringify({ msg: `${CANARY} ${quoted}` });
    const masked = knowing(quoted).mask(line);
    expect(masked).not.toContain(JSON.stringify(quoted).slice(1, -1));
    expect(masked).toContain(CANARY);
  });

  it('hides a value percent-encoded in an address', () => {
    const email = 'operator+bank@example.com';
    const text = `GET https://bank.example/u?email=${encodeURIComponent(email)} ${CANARY}`;
    const masked = knowing(email).mask(text);
    expect(masked).not.toContain(encodeURIComponent(email));
    expect(masked).toContain(CANARY);
  });

  it('hides the longer of two overlapping values whole', () => {
    expect(knowing('Qz7-', 'Qz7-echoed').mask(`Qz7-echoed ${CANARY}`)).toBe(`[REDACTED] ${CANARY}`);
  });

  it('reads a value\'s regex characters as text', () => {
    const masked = knowing('a.b*c+(d)').mask(`a.b*c+(d) aXbbbc+d ${CANARY}`);
    expect(masked).toBe(`[REDACTED] aXbbbc+d ${CANARY}`);
  });

  it('reads a value that would backtrack as text, so masking stays fast', () => {
    const run = 'b'.repeat(26);
    const started = performance.now();
    const masked = knowing(BACKTRACKING).mask(`${run}! ${BACKTRACKING} ${CANARY}`);
    const elapsedMs = performance.now() - started;
    expect(masked).toBe(`${run}! [REDACTED] ${CANARY}`);
    expect(elapsedMs).toBeLessThan(FAST_MS);
  });

  it.each(PLACEMENTS)('masking a masked text as %s again changes nothing', (_placement, text) => {
    const known = knowing(VALUE);
    const once = known.mask(text);
    expect(known.mask(once)).toBe(once);
  });

  it('keeps the mask itself whole when a value is part of it', () => {
    expect(knowing('DACT').mask(`[REDACTED] ${CANARY}`)).toBe(`[REDACTED] ${CANARY}`);
  });

  it('leaves the text as it is when no value is known', () => {
    const text = `${VALUE} ${CANARY}`;
    expect(new SecretValues().mask(text)).toBe(text);
  });

  it('counts a value registered twice once', () => {
    const known = new SecretValues();
    const first = known.register([VALUE]);
    expect(known.register([VALUE])).toBe(first);
  });

  it('keeps masking a value after others are registered', () => {
    const known = knowing(VALUE);
    known.register(['Other-value-42']);
    expect(known.mask(`${VALUE} Other-value-42 ${CANARY}`)).toBe(`[REDACTED] [REDACTED] ${CANARY}`);
  });

  it.each([
    ['upper case', 'OPERATOR@EXAMPLE.COM'],
    ['lower case', 'operator@example.com'],
  ])('hides a value the bank quotes back in %s', (_letterCase, quoted) => {
    expect(knowing('Operator@Example.com').mask(`${quoted} ${CANARY}`)).toBe(`[REDACTED] ${CANARY}`);
  });
});

describe('SecretValues with a value under six characters', () => {
  it.each(SHORT_CASES)('hides %j standing alone as %s', (value, _placement, text, masked) => {
    expect(knowing(value).mask(text)).toBe(masked);
  });

  it.each([
    ['test', 'Processing bank: e2eTestBank'],
    ['a', `abc ${CANARY}`],
    ['k9Qab', `Xk9QabY ${CANARY}`],
    ['k9Q', `Xk9Q ${CANARY}`],
    ['123', 'Balance: 1234.5 ILS'],
    ['דני', `דניאל ${CANARY}`],
  ])('keeps %j where it is only part of %j', (value, text) => {
    expect(knowing(value).mask(text)).toBe(text);
  });

  it.each([
    ['test', 'e2e-test-bank', 'e2e-[REDACTED]-bank'],
    ['test', 'INVALID_TEST', 'INVALID_[REDACTED]'],
    ['-k9', `ab-k9 ${CANARY}`, `ab[REDACTED] ${CANARY}`],
    ['k9-', `k9-ab ${CANARY}`, `[REDACTED]ab ${CANARY}`],
  ])('hides %j in %j, where a separator ends the word', (value, text, masked) => {
    expect(knowing(value).mask(text)).toBe(masked);
  });

  it('hides a value of six characters inside a longer word', () => {
    expect(knowing('k9Qab7').mask(`Xk9Qab7Y ${CANARY}`)).toBe(`X[REDACTED]Y ${CANARY}`);
  });

  it.each(['[', 'R', ']', 'D]', 'ED'])('keeps a mask whole with %j held, and masking again changes nothing', value => {
    const known = knowing(value);
    const once = known.mask(`[REDACTED] ${value} ${CANARY}`);
    expect(once).toBe(`[REDACTED] [REDACTED] ${CANARY}`);
    expect(known.mask(once)).toBe(once);
  });

  it('registers no form of an empty value', () => {
    const known = new SecretValues();
    expect(known.register([''])).toBe(0);
    expect(known.mask(`abc ${CANARY}`)).toBe(`abc ${CANARY}`);
  });
});

describe('SecretValues with a lone surrogate in a value', () => {
  /** Half of a surrogate pair with no other half, as a JSON `\ud800` escape decodes. */
  const LONE = 'Qz7\uD800echoed';

  /** A whole pair, an emoji, which must be encoded as itself. */
  const PAIRED = 'Qz7😀echoed';

  it('registers the value without throwing', () => {
    expect(() => knowing(LONE)).not.toThrow();
  });

  it.each([
    ['as it is', LONE],
    ['as a UTF-8 file writes it', 'Qz7\uFFFDechoed'],
    ['escaped inside a JSON string', JSON.stringify(LONE).slice(1, -1)],
    ['percent-encoded by a URL encoder', new URLSearchParams({ u: LONE }).toString().slice(2)],
  ])('hides it %s', (_form, written) => {
    expect(knowing(LONE).mask(`${CANARY} ${written} ${CANARY}`)).toBe(`${CANARY} [REDACTED] ${CANARY}`);
  });

  it('percent-encodes a whole pair as itself', () => {
    const written = encodeURIComponent(PAIRED);
    expect(knowing(PAIRED).mask(`${CANARY} ${written} ${CANARY}`)).toBe(`${CANARY} [REDACTED] ${CANARY}`);
  });

  it.each([
    ['that starts with a lone half, as it is', '\uD800a', '\uD800a'],
    ['that starts with a lone half, as a UTF-8 file writes it', '\uD800a', '\uFFFDa'],
    ['that starts with a lone half, escaped inside a JSON string', '\uD800a', String.raw`\ud800a`],
    ['that starts with a lone half, percent-encoded', '\uD800a', '%EF%BF%BDa'],
    ['that ends with a lone half, as it is', 'ab\uDC00', 'ab\uDC00'],
    ['that ends with a lone half, as a UTF-8 file writes it', 'ab\uDC00', 'ab\uFFFD'],
    ['that ends with a lone half, escaped inside a JSON string', 'ab\uDC00', String.raw`ab\udc00`],
    ['that ends with a lone half, percent-encoded', 'ab\uDC00', 'ab%EF%BF%BD'],
  ])('hides a short value %s, inside a longer word', (_form, value, written) => {
    expect(knowing(value).mask(`${CANARY}${written}${CANARY}`)).toBe(`${CANARY}[REDACTED]${CANARY}`);
  });
});

describe('SecretValues with a lone half that pairs with the text beside it', () => {
  /** An emoji: the high half `\uD83D` and the low half `\uDE00`, one character. */
  const EMOJI = '😀';

  it.each([
    ['a low half after a high half in the text', '\uDE00secret', `${EMOJI}secret`],
    ['a high half before a low half in the text', 'secret\uD83D', `secret${EMOJI}`],
    ['a short value that starts with a low half', '\uDE00ab', `${EMOJI}ab`],
    ['a short value that ends with a high half', 'ab\uD83D', `ab${EMOJI}`],
    ['a value that is one high half', '\uD83D', EMOJI],
    ['a value that is one low half', '\uDE00', EMOJI],
    ['a value quoted back in another case', '\uDE00Secret', `${EMOJI}sECRET`],
  ])('hides the whole character around %s', (_case, value, written) => {
    expect(knowing(value).mask(`${CANARY} ${written} ${CANARY}`)).toBe(`${CANARY} [REDACTED] ${CANARY}`);
  });

  it('hides a short value that holds a lone half inside a longer word too', () => {
    expect(knowing('\uDE00ab').mask(`${CANARY} ${EMOJI}abNx ${CANARY}`)).toBe(`${CANARY} [REDACTED]Nx ${CANARY}`);
  });

  it('finds a value that starts inside the character an earlier match ends in', () => {
    expect(knowing('\uD83D', '\uDE00secret').mask(`${CANARY} ${EMOJI}secret ${CANARY}`))
      .toBe(`${CANARY} [REDACTED] ${CANARY}`);
  });

  it('hides a value whole when a shorter one starts at the same place', () => {
    expect(knowing('\uDE00', '\uDE00secret').mask(`${CANARY} ${EMOJI}secret ${CANARY}`))
      .toBe(`${CANARY} [REDACTED] ${CANARY}`);
  });

  it('masks a long run of paired halves fast', () => {
    const text = `${EMOJI.repeat(10_000)} ${CANARY}`;
    const known = knowing('\uDE00');
    expect(known.mask(text)).toBe(`${MASK.repeat(10_000)} ${CANARY}`);
    expect(fastestRunMs(() => known.mask(text), FAST_MS)).toBeLessThan(FAST_MS);
  });
});
