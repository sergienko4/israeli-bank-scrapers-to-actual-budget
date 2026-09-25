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
