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

/** Where a quoted credential can sit in a bank's words. */
const PLACEMENTS: readonly [string, string][] = [
  ['the first word', `${VALUE} ${CANARY}`],
  ['mid-sentence', `Form: user ${VALUE} is not valid ${CANARY}`],
  ['the last word', `${CANARY} ${VALUE}`],
  ['twice', `${VALUE} ${CANARY} ${VALUE}`],
  ['between punctuation', `${CANARY} (${VALUE}).`],
  ['inside quotes', `${CANARY} "${VALUE}"`],
  ['inside an address', `GET https://bank.example/login?user=${VALUE}&x=1 ${CANARY}`],
  ['with no space around it', `${CANARY}:${VALUE}:${CANARY}`],
];

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

  it.each(['', 'a', 'ab', 'abc'])('does not mask %j, shorter than four characters, as bare text', (value) => {
    expect(knowing(value).mask(`abc ${CANARY}`)).toBe(`abc ${CANARY}`);
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
