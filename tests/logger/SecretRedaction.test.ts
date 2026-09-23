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

  const WHOLE_VALUES: [string, string, string][] = [
    ['a double-quoted phrase', 'password: "my secret phrase" bank=leumi', 'password: "[REDACTED]" bank=leumi'],
    ['a single-quoted phrase', "{ password: 'my secret phrase', bank: 'leumi' }", "{ password: '[REDACTED]', bank: 'leumi' }"],
    ['a JSON phrase', '{"password":"my secret phrase","bank":"leumi"}', '{"password":"[REDACTED]","bank":"leumi"}'],
    ['a quote escaped inside', String.raw`{"password":"my \"secret\" phrase","bank":"leumi"}`, '{"password":"[REDACTED]","bank":"leumi"}'],
    ['an escaped JSON phrase', String.raw`{\"password\":\"my secret phrase\",\"bank\":\"leumi\"}`, String.raw`{\"password\":\"[REDACTED]\",\"bank\":\"leumi\"}`],
    ['an escaped JSON quote inside', String.raw`{\"password\":\"my \\\"secret\\\" phrase\",\"bank\":\"leumi\"}`, String.raw`{\"password\":\"[REDACTED]\",\"bank\":\"leumi\"}`],
    ['twice-escaped JSON', String.raw`{\\\"password\\\":\\\"my secret\\\",\\\"user\\\":1}`, String.raw`{\\\"password\\\":\\\"[REDACTED]\\\",\\\"user\\\":1}`],
    ['a quoted scheme and token', '"authorization": "Basic my secret" next', '"authorization": "[REDACTED]" next'],
    ['the other quote inside', `password: "it's my secret" bank=leumi`, 'password: "[REDACTED]" bank=leumi'],
    ['a value that spans lines', "secret: 'line one\nline two' end", "secret: '[REDACTED]' end"],
    ['a value ending in a backslash, then logfmt', String.raw`password="pa55\\" idToken="${TEST_CREDENTIAL}"`, 'password="[REDACTED]" idToken="[REDACTED]"'],
    ['a value ending in a backslash, then inspect', String.raw`{ password: 'pa55\\', idToken: '${TEST_CREDENTIAL}' }`, "{ password: '[REDACTED]', idToken: '[REDACTED]' }"],
    ['a JSON value ending in a backslash', String.raw`{"password":"pa55\\","bank":"leumi"}`, '{"password":"[REDACTED]","bank":"leumi"}'],
    ['an escaped JSON value ending in a backslash', String.raw`{\"password\":\"pa55\\\\\",\"bank\":\"leumi\"}`, String.raw`{\"password\":\"[REDACTED]\",\"bank\":\"leumi\"}`],
    ['a backtick-quoted phrase', "{ password: `it's \"my\" secret`, bank: 'leumi' }", "{ password: `[REDACTED]`, bank: 'leumi' }"],
    ['a cookie attribute', 'Set-Cookie: token="blue river"; Path=/', 'Set-Cookie: token="[REDACTED]"; Path=/'],
    ['a value in parentheses', '(password: "blue river") retry', '(password: "[REDACTED]") retry'],
    ['a value in brackets', '[secret="blue river"] retry', '[secret="[REDACTED]"] retry'],
    ['a JSON object that ends the text', '{"code":"E1","token":"blue river"}', '{"code":"E1","token":"[REDACTED]"}'],
    ['a list of JSON objects', '[{"token":"blue river"},{"code":"E1"}]', '[{"token":"[REDACTED]"},{"code":"E1"}]'],
    ['a compact single-quoted object', "{'token':'blue river','bank':'leumi'}", "{'token':'[REDACTED]','bank':'leumi'}"],
    ['a snippet cut inside the value', '401: {"password":"my secret phr', '401: {"password=[REDACTED]'],
  ];

  it.each(WHOLE_VALUES)('hides all of %s and keeps what follows', (_shape, text, expected) => {
    expect(redactSecrets(text)).toBe(expected);
  });

  const CHAINED_VALUES: [string, string, string][] = [
    ['a key on the next line', `clientSecret:\nauthToken: ${TEST_CREDENTIAL} tail`, 'clientSecret=[REDACTED] tail'],
    ['a JSON null, then a spaced value', `{"client_secret":null,"access_token": "${TEST_CREDENTIAL}"} tail`, '{"client_secret":"[REDACTED]"} tail'],
    ['an empty value, then a key', `card_cvv=,idToken: ${TEST_CREDENTIAL} tail`, 'card_cvv=[REDACTED] tail'],
    ['a JSON null, then a phrase', `{"token":null,"idToken": "sms ${TEST_CREDENTIAL}"} tail`, '{"token":"[REDACTED]"} tail'],
    ['an escaped JSON null, then a phrase', String.raw`{\"token\":null,\"idToken\": \"sms ${TEST_CREDENTIAL}\"} tail`, String.raw`{\"token\":\"[REDACTED]\"} tail`],
    ['two keys on the lines below', `clientSecret:\nauthToken:\nidToken: ${TEST_CREDENTIAL} tail`, 'clientSecret=[REDACTED] tail'],
    ['an empty logfmt value, then a key', `secret= idToken= ${TEST_CREDENTIAL} tail`, 'secret=[REDACTED] tail'],
    ['a compact JSON null, then a phrase', `{"token":null,"idToken":"sms ${TEST_CREDENTIAL}"} tail`, '{"token":"[REDACTED]"} tail'],
    ['a compact escaped JSON null, then a phrase', String.raw`{\"token\":null,\"idToken\":\"sms ${TEST_CREDENTIAL}\"} tail`, String.raw`{\"token\":\"[REDACTED]\"} tail`],
    ['a JSON null, then an object', `{"token":null,"session":{"otp":"sms ${TEST_CREDENTIAL}"}} tail`, '{"token=[REDACTED]'],
    ['a bare null, then a bearer', `token=null,authorization=Bearer ${TEST_CREDENTIAL} tail`, 'token=[REDACTED] tail'],
    ['an empty value, then a basic scheme', `idToken=;jwt=Basic ${TEST_CREDENTIAL} tail`, 'idToken=[REDACTED] tail'],
  ];

  it.each(CHAINED_VALUES)('hides the value that a separator in a bare value introduces: %s', (_shape, text, expected) => {
    expect(redactSecrets(text)).toBe(expected);
  });

  const SEPARATOR_VALUES: [string, string, string][] = [
    ['a quoted phrase', 'secret: "note: blue river" next', 'secret: "[REDACTED]" next'],
    ['a single-quoted phrase', "secret: 'note: blue river' next", "secret: '[REDACTED]' next"],
    ['an object', `secret: {"code": "E1", "otp": "${TEST_CREDENTIAL}"} next`, 'secret=[REDACTED]'],
    ['a list of objects', `secret: [{"code": "E1"}, {"otp": "${TEST_CREDENTIAL}"}] next`, 'secret=[REDACTED]'],
    ['an escaped JSON phrase', String.raw`{\"secret\":\"note: blue river\",\"user\":1}`, String.raw`{\"secret\":\"[REDACTED]\",\"user\":1}`],
    ['a backtick phrase', 'secret: `note: blue river` next', 'secret: `[REDACTED]` next'],
  ];

  it.each(SEPARATOR_VALUES)('hides all of %s that holds a separator', (_shape, text, expected) => {
    expect(redactSecrets(text)).toBe(expected);
  });

  it('keeps the sentence after a quoted value', () => {
    expect(redactSecrets('secret: "blue river". Verify it')).toBe('secret: "[REDACTED]". Verify it');
  });

  it('does not end a value at a quote the next value opens with a period', () => {
    const text = String.raw`secret="a\" idToken=".${TEST_CREDENTIAL}"`;
    expect(redactSecrets(text)).toBe('secret="[REDACTED]"');
  });

  it.each([
    ['directly', `secret=[REDACTED]${TEST_CREDENTIAL} tail`],
    ['after a comma', `secret=[REDACTED],${TEST_CREDENTIAL} tail`],
    ['after a semicolon', `secret=[REDACTED];${TEST_CREDENTIAL} tail`],
    ['after a parenthesis', `secret=[REDACTED])${TEST_CREDENTIAL} tail`],
    ['after a period', `secret=[REDACTED].${TEST_CREDENTIAL} tail`],
    ['before a quote', `secret=[REDACTED]"${TEST_CREDENTIAL}" tail`],
    ['after a comma, before a single quote', `secret=[REDACTED],'${TEST_CREDENTIAL}' tail`],
    ['after a comma, before a backtick', `secret=[REDACTED],\`${TEST_CREDENTIAL}\` tail`],
    ['after a comma, before a double quote', `secret=[REDACTED],"${TEST_CREDENTIAL}" tail`],
    ['after a brace, before an object', `secret=[REDACTED]},{"${TEST_CREDENTIAL}" tail`],
    ['after a comma and a space', `secret=[REDACTED], ${TEST_CREDENTIAL} tail`],
  ])('hides a value that only starts like masked text, %s', (_shape, text) => {
    expect(redactSecrets(text)).toBe('secret=[REDACTED]');
  });

  it.each([
    ['a bare value', 'secret=[REDACTED] tail'],
    ['a bare value ending a sentence', 'secret=[REDACTED]. Verify it'],
    ['a bare value ending the text', 'secret=[REDACTED]'],
    ['a bare value before a closing period', 'secret=[REDACTED].'],
    ['a quoted value', 'secret="[REDACTED]", bank=leumi'],
  ])('leaves its own output for %s unchanged', (_shape, text) => {
    expect(redactSecrets(text)).toBe(text);
  });

  it('keeps a JSON body valid', () => {
    const text = `{"idToken":"sms ${TEST_CREDENTIAL}","bank":"leumi"}`;
    expect(JSON.parse(redactSecrets(text))).toEqual({ idToken: '[REDACTED]', bank: 'leumi' });
  });

  it.each([...WHOLE_VALUES, ...CHAINED_VALUES, ...SEPARATOR_VALUES])(
    'masks %s the same way a second time', (_shape, text) => {
      const once = redactSecrets(text);
      expect(redactSecrets(once)).toBe(once);
    },
  );

  it.each([
    `idToken=${TEST_CREDENTIAL} for account 4455 (HTTP 401), retry later`,
    `secret: "sms ${TEST_CREDENTIAL}". Verify it`,
    `{"idToken": "${TEST_CREDENTIAL}", "code": "E1"}`,
    `401: {"idToken":"${TEST_CREDENTIAL}`,
    `clientSecret:\nauthToken: ${TEST_CREDENTIAL} tail`,
    `TOKEN=${TEST_CREDENTIAL} CreditCard: ${TEST_CREDENTIAL}`,
  ])('masks %j the same way a second time', (text) => {
    const once = redactSecrets(text);
    expect(redactSecrets(once)).toBe(once);
  });

  it('keeps advice appended after a masked snippet through a second pass', () => {
    const masked = `${redactSecrets(`401: {"idToken":"${TEST_CREDENTIAL}`)}. Verify it.`;
    expect(redactSecrets(masked)).toBe('401: {"idToken=[REDACTED]. Verify it.');
  });

  it('keeps the key name so the reader knows what was hidden', () => {
    const text = `rejected persistentOtpToken: ${TEST_CREDENTIAL}`;
    expect(redactSecrets(text)).toBe('rejected persistentOtpToken=[REDACTED]');
  });

  it('hides every secret in one message, whatever the key case', () => {
    const text = `TOKEN=${TEST_CREDENTIAL} CreditCard: ${TEST_CREDENTIAL}`;
    expect(redactSecrets(text)).toBe('TOKEN=[REDACTED] CreditCard=[REDACTED]');
  });

  it.each(['_', 'a_', 'a-', 'token="\\', 'token: ', 'token:\n', 'token: a: '])('scans a long run of %j in linear time', (unit) => {
    const text = unit.repeat(100_000);
    const started = performance.now();
    redactSecrets(text);
    expect(performance.now() - started).toBeLessThan(250);
  });

  it.each(['token="', String.raw`token=\"`])('scans a long run of backslashes after %j in linear time', (opening) => {
    const text = `${opening}${'\\'.repeat(100_000)} tail`;
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
