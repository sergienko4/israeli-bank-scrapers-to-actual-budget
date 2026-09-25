/**
 * Long-term tokens the value masker must know.
 *
 * <p>A long-term token is a standing bypass of the bank's second factor. A
 * bank or a network error can quote it back with no key in front of it, which
 * the key rule cannot see. So every token this process reads from the store,
 * or is about to write to it, is handed to the value masker first, and no
 * output can show it.
 */

import { describe, expect, it } from 'vitest';

import redactSecrets from '../../src/Logger/SecretRedaction.js';
import { CAPTURED_AT, fakeToken, makeStore, seedRecords, STORE_PATH } from './BankTokenStoreFixture.js';

/** Text outside the token, which masking must keep. */
const CANARY = 'token-error-canary';

/**
 * Wraps a token the way an error can quote it: bare, with no key.
 * @param token - The echoed token.
 * @returns The error text.
 */
function echoed(token: string): string {
  return `POST https://bank.example/auth failed for ${token} ${CANARY}`;
}

describe('BankTokenStore and the value masker', () => {
  it('hides every stored token once the store is read', () => {
    const { store, fileSystem } = makeStore();
    const [wanted, other] = [fakeToken(), fakeToken()];
    seedRecords(fileSystem, {
      'oneZero:main': { token: wanted, capturedAt: CAPTURED_AT },
      'pepper:main': { token: other, capturedAt: CAPTURED_AT },
    });
    store.read('oneZero:main');
    const masked = redactSecrets(`${echoed(wanted)} ${echoed(other)}`);
    expect(masked).not.toContain(wanted);
    expect(masked).not.toContain(other);
  });

  it('hides a token as soon as it is written, as the store keeps it', () => {
    const { store } = makeStore();
    const token = fakeToken();
    store.write('oneZero:main', `  ${token}\n`);
    expect(redactSecrets(echoed(token))).toBe(echoed('[REDACTED]'));
  });

  it('hides a token the store could not write', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedDirectory(STORE_PATH);
    const token = fakeToken();
    expect(store.write('oneZero:main', token)).toMatchObject({ success: false });
    expect(redactSecrets(echoed(token))).not.toContain(token);
  });

  it('keeps the account a token belongs to readable', () => {
    const { store } = makeStore();
    store.write('oneZero:savings-account', fakeToken());
    const text = `no token for oneZero:savings-account ${CANARY}`;
    expect(redactSecrets(text)).toBe(text);
  });
});
