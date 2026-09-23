/**
 * Free-text secret redaction tests.
 *
 * Scraper errors carry the first 120 characters of a bank's response body,
 * and banks sometimes echo credentials there. One redactor masks that text
 * before it reaches a log line, a metrics record or a notification, so the
 * shapes below are the ones a bank, a header or a JSON body really produce.
 */
import { describe, expect, it } from 'vitest';

import redactSecrets from '../../src/Logger/SecretRedaction.js';
import { TEST_CREDENTIAL } from '../helpers/testCredentials.js';

describe('redactSecrets', () => {
  it.each([
    ['the credentials alias', `otpLongTermToken=${TEST_CREDENTIAL}`],
    ['the auth-flow alias', `longTermToken: ${TEST_CREDENTIAL}`],
    ['the result alias', `persistentOtpToken=${TEST_CREDENTIAL}`],
    ['the minted id token', `idToken=${TEST_CREDENTIAL}`],
    ['the PayBox body key', `access_token=${TEST_CREDENTIAL}`],
    ['a snake-case id token', `id_token: ${TEST_CREDENTIAL}`],
    ['a browser-bank session token', `calConnectToken=${TEST_CREDENTIAL}`],
    ['a hyphenated header', `x-auth-token: ${TEST_CREDENTIAL}`],
    ['a bare JWT key', `jwt=${TEST_CREDENTIAL}`],
    ['a password', `password=${TEST_CREDENTIAL}`],
    ['a bearer header value', `bearer=Bearer ${TEST_CREDENTIAL}`],
    ['an authorization header', `Authorization: Bearer ${TEST_CREDENTIAL}`],
    ['a basic authorization header', `authorization: Basic ${TEST_CREDENTIAL}`],
    ['a quoted JSON key', `{"longTermToken":"${TEST_CREDENTIAL}"}`],
    ['a quoted JSON bearer', `{"bearer": "Bearer ${TEST_CREDENTIAL}"}`],
    ['escaped JSON', String.raw`{\"idToken\":\"${TEST_CREDENTIAL}\"}`],
    ['an escaped JSON bearer', String.raw`{\"Authorization\":\"Bearer ${TEST_CREDENTIAL}\"}`],
    ['an inspected bearer', `{ bearer: 'Bearer ${TEST_CREDENTIAL}' }`],
    ['an inspected hyphenated key', `{ 'x-auth-token': '${TEST_CREDENTIAL}' }`],
    ['a header array', `{"Authorization":["Bearer ${TEST_CREDENTIAL}"]}`],
    ['a spaced list of values', `{"Authorization": ["Basic abc", "${TEST_CREDENTIAL}"]}`],
    ['a secret nested under a secret key', `{"auth": {"otpLongTermToken": "${TEST_CREDENTIAL}"}}`],
    ['an object held by a secret key', `{"token": {"value": "${TEST_CREDENTIAL}", "exp": 1}}`],
    ['a pretty-printed object', `{\n  "token": {\n    "value": "${TEST_CREDENTIAL}"\n  }\n}`],
    ['a value on the next line', `token:\n  ${TEST_CREDENTIAL}`],
    ['a URL query string', `GET /sync?access_token=${TEST_CREDENTIAL}&page=2`],
    ['a snake-case client secret', `{"client_secret":"${TEST_CREDENTIAL}"}`],
    ['a camel-case client secret', `clientSecret: ${TEST_CREDENTIAL}`],
    ['a snake-case password', `new_password=${TEST_CREDENTIAL}`],
    ['a camel-case password', `userPassword: ${TEST_CREDENTIAL}`],
    ['a snake-case card code', `card_cvv=${TEST_CREDENTIAL}`],
  ])('hides the value of %s', (_shape, text) => {
    expect(redactSecrets(`login failed ${text}`)).not.toContain(TEST_CREDENTIAL);
  });

  it('keeps the key name so the reader knows what was hidden', () => {
    const text = `rejected persistentOtpToken: ${TEST_CREDENTIAL}`;
    expect(redactSecrets(text)).toBe('rejected persistentOtpToken=[REDACTED]');
  });

  it('hides every secret in one message, whatever the key case', () => {
    const text = `TOKEN=${TEST_CREDENTIAL} CreditCard: ${TEST_CREDENTIAL}`;
    expect(redactSecrets(text)).toBe('TOKEN=[REDACTED] CreditCard=[REDACTED]');
  });

  it.each(['_', 'a_', 'a-'])('scans a long run of %j in linear time', (unit) => {
    const text = unit.repeat(100_000);
    const started = performance.now();
    redactSecrets(text);
    expect(performance.now() - started).toBeLessThan(250);
  });

  it.each([
    'AuthenticationError: bank rejected the login',
    'tokenize: step failed',
    'maxTokens: 5',
    'author: someone',
    'OAuth: provider unavailable',
    'Set twoFactorAuth: true for this bank and configure Telegram or the mobile app',
    'Config portal on http://127.0.0.1:3000 (auth mode: password)',
    '',
  ])('leaves %j unchanged', (text) => {
    expect(redactSecrets(text)).toBe(text);
  });
});
