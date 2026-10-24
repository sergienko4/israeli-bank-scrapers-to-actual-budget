import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import tokenDigest, { isTokenDigest } from '../../src/Scraper/Tokens/TokenDigest.js';

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.long-term.token';

describe('tokenDigest', () => {
  it('is 64 lowercase hex characters and never the token itself', () => {
    const digest = tokenDigest(TOKEN);

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain('long-term');
  });

  it('is the same for the same token, so a refusal is found again next run', () => {
    expect(tokenDigest(TOKEN)).toBe(tokenDigest(TOKEN));
  });

  it('ignores surrounding whitespace, as the resolver sends the trimmed token', () => {
    expect(tokenDigest(`  ${TOKEN}\n`)).toBe(tokenDigest(TOKEN));
  });

  it('tells different tokens apart', () => {
    expect(tokenDigest(`${TOKEN}x`)).not.toBe(tokenDigest(TOKEN));
  });

  it('is domain-separated, so it is not a plain SHA-256 of the token', () => {
    const plain = createHash('sha256').update(TOKEN, 'utf8').digest('hex');

    expect(tokenDigest(TOKEN)).not.toBe(plain);
  });

  it('pins the v1 recipe, so digests saved by an earlier run still match', () => {
    const expected = createHash('sha256')
      .update(`refused-long-term-token:v1\0${TOKEN}`, 'utf8').digest('hex');

    expect(tokenDigest(TOKEN)).toBe(expected);
  });
});

describe('isTokenDigest', () => {
  it('accepts a digest the module made', () => {
    expect(isTokenDigest(tokenDigest(TOKEN))).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['uppercase hex', 'A'.repeat(64)],
    ['63 characters', 'a'.repeat(63)],
    ['65 characters', 'a'.repeat(65)],
    ['a raw token', TOKEN],
    ['not a string', 42],
  ])('rejects %s', (_label, value) => {
    expect(isTokenDigest(value)).toBe(false);
  });
});
