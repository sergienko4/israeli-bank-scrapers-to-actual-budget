/**
 * Free-text secret redaction tests.
 *
 * Scraper errors carry the first 120 characters of a bank's response body,
 * and banks sometimes echo credentials there. One redactor masks that text
 * before it reaches a log line, a metrics record or a notification, so the
 * shapes below are the ones a bank, a header or a JSON body really produce.
 */
import { describe, expect, it } from 'vitest';

import redactSecrets, { isSecretKey } from '../../src/Logger/SecretRedaction.js';
import { TEST_CREDENTIAL } from '../helpers/testCredentials.js';

/** The time a linear scan of a 100k-repeat text stays well within. */
const LINEAR_LIMIT_MS = 250;

/**
 * Times a scan, trying up to three times until one finishes within the
 * limit. Other work on the machine can only slow a run, so one slow run is
 * noise, while a quadratic scan is slow every time.
 * @param scan - The scan to time.
 * @returns The fastest run's time, in milliseconds.
 */
function fastestRunMs(scan: () => unknown): number {
  let fastest = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < 3 && fastest >= LINEAR_LIMIT_MS; attempt++) {
    const started = performance.now();
    scan();
    fastest = Math.min(fastest, performance.now() - started);
  }
  return fastest;
}

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
    ['a phone number', `phoneNumber=${TEST_CREDENTIAL}`],
    ['a capitalised phone number', `PhoneNumber: ${TEST_CREDENTIAL}`],
    ['a snake-case phone number in JSON', `{"phone_number":"${TEST_CREDENTIAL}"}`],
    ['a hyphenated phone number', `phone-number=${TEST_CREDENTIAL}`],
    ['a card code after a Hebrew prefix letter', `בCVV: ${TEST_CREDENTIAL}`],
    ['an auth key after a mark, which may end the word before it', `twoFactor\u200eAuth: ${TEST_CREDENTIAL}`],
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

  const PHONE_VALUES: [string, string, string][] = [
    ['an international number', 'login failed phoneNumber=+972 50-000-0016', 'login failed phoneNumber=[REDACTED]'],
    ['a local number in groups', 'phone_number: 050 000 0016 retry', 'phone_number=[REDACTED] retry'],
    ['a bracketed country code', 'phoneNumber=(+972) 50 000 0016, retry', 'phoneNumber=[REDACTED] retry'],
    ['groups split by tabs', 'phoneNumber=050\t000\t0016 retry', 'phoneNumber=[REDACTED] retry'],
    ['a word that only starts with a digit', 'phoneNumber=050 000 0016 2nd try', 'phoneNumber=[REDACTED] 2nd try'],
    ['a number on the next line', 'phoneNumber=050\n2 attempts', 'phoneNumber=[REDACTED]\n2 attempts'],
    ['groups split by no-break spaces', 'phoneNumber=+972\u00a050\u00a0123\u00a04567 retry', 'phoneNumber=[REDACTED] retry'],
    ['groups split by narrow no-break spaces', 'phoneNumber=050\u202f123\u202f4567 retry', 'phoneNumber=[REDACTED] retry'],
    ['groups split by spaced dashes', 'phoneNumber=050 \u2013 123 - 4567 retry', 'phoneNumber=[REDACTED] retry'],
    ['a number before an exclamation mark', 'phoneNumber=050 1234567! retry', 'phoneNumber=[REDACTED] retry'],
    ['a number before a question mark', 'phoneNumber=050 123 4567? retry', 'phoneNumber=[REDACTED] retry'],
    ['a number before a colon', 'phoneNumber=050 123 4567: retry', 'phoneNumber=[REDACTED] retry'],
    ['a number in brackets', '[phoneNumber=050 123 4567] retry', '[phoneNumber=[REDACTED] retry'],
    ['a number before Hebrew text', 'phoneNumber=050 123 4567 \u05e0\u05e1\u05d4', 'phoneNumber=[REDACTED] \u05e0\u05e1\u05d4'],
  ];

  it.each(PHONE_VALUES)('hides every digit group of %s', (_shape, text, expected) => {
    expect(redactSecrets(text)).toBe(expected);
  });

  const INVISIBLE_VALUES: [string, string, string][] = [
    ['a left-to-right mark before a spaced number', 'phoneNumber=\u200e +972 50-123-4567', 'phoneNumber=[REDACTED]'],
    ['a right-to-left mark before a number', 'phoneNumber=\u200f050 123 4567 retry', 'phoneNumber=[REDACTED] retry'],
    ['a bidi isolate around a number', 'phone_number=\u2066+972 50-123-4567\u2069 failed', 'phone_number=[REDACTED] failed'],
    ['a bidi isolate inside a bracket', 'phoneNumber=(\u2066+972) 50 123 retry', 'phoneNumber=[REDACTED] retry'],
    ['a zero-width space after the plus', 'phoneNumber=+\u200b972 50 retry', 'phoneNumber=[REDACTED] retry'],
    ['a mark before the separator', 'phoneNumber\u200e=050 123 retry', 'phoneNumber=[REDACTED] retry'],
    ['a mark before a token', `idToken=\u200e ${TEST_CREDENTIAL} tail`, 'idToken=[REDACTED] tail'],
    ['a mark after an auth scheme', `authorization: Basic\u200e ${TEST_CREDENTIAL} tail`, 'authorization=[REDACTED] tail'],
    ['a mark after a chained separator', `token=null,idToken:\u200e ${TEST_CREDENTIAL} tail`, 'token=[REDACTED] tail'],
  ];

  it.each(INVISIBLE_VALUES)('reads an invisible format character as a space: %s', (_shape, text, expected) => {
    expect(redactSecrets(text)).toBe(expected);
  });

  const SCHEME_VALUES: [string, string, string][] = [
    ['a Token scheme', `Authorization: Token ${TEST_CREDENTIAL} tail`, 'Authorization=[REDACTED] tail'],
    ['a lowercase token scheme', `authorization: token ${TEST_CREDENTIAL} tail`, 'authorization=[REDACTED] tail'],
    ['a DPoP scheme', `Authorization: DPoP ${TEST_CREDENTIAL} tail`, 'Authorization=[REDACTED] tail'],
    ['a GNAP scheme', `Authorization: GNAP ${TEST_CREDENTIAL} tail`, 'Authorization=[REDACTED] tail'],
    ['a Negotiate scheme', `Authorization: Negotiate ${TEST_CREDENTIAL} tail`, 'Authorization=[REDACTED] tail'],
    ['an NTLM scheme', `Authorization: NTLM ${TEST_CREDENTIAL} tail`, 'Authorization=[REDACTED] tail'],
    ['a proxy header with a Token scheme', `Proxy-Authorization: Token ${TEST_CREDENTIAL} tail`, 'Proxy-Authorization=[REDACTED] tail'],
    ['a bare null, then a Token scheme', `token=null,authorization=Token ${TEST_CREDENTIAL} tail`, 'token=[REDACTED] tail'],
  ];

  it.each(SCHEME_VALUES)('hides the credential after the auth scheme in %s', (_shape, text, expected) => {
    expect(redactSecrets(text)).toBe(expected);
  });

  const PARAM_SCHEME_VALUES: [string, string, string][] = [
    ['a Digest scheme', `Authorization: Digest username="leumi-user", realm="api", response="${TEST_CREDENTIAL}"\nnext`, 'Authorization=[REDACTED]\nnext'],
    ['a lowercase digest scheme', `authorization: digest response="${TEST_CREDENTIAL}"\nnext`, 'authorization=[REDACTED]\nnext'],
    ['an OAuth scheme', `Authorization: OAuth oauth_consumer_key="k1", oauth_signature="${TEST_CREDENTIAL}"\nnext`, 'Authorization=[REDACTED]\nnext'],
    ['a vapid scheme', `Authorization: vapid t=${TEST_CREDENTIAL}, k=BPublicKey\nnext`, 'Authorization=[REDACTED]\nnext'],
    ['a HOBA scheme', `Authorization: HOBA result="${TEST_CREDENTIAL}"\nnext`, 'Authorization=[REDACTED]\nnext'],
    ['a Mutual scheme', `Authorization: Mutual sid=1, kc1="${TEST_CREDENTIAL}"\nnext`, 'Authorization=[REDACTED]\nnext'],
    ['a Concealed scheme', `Authorization: Concealed k="key1", s="${TEST_CREDENTIAL}"\nnext`, 'Authorization=[REDACTED]\nnext'],
    ['a PrivateToken scheme', `Authorization: PrivateToken token="${TEST_CREDENTIAL}"\nnext`, 'Authorization=[REDACTED]\nnext'],
    ['a SCRAM-SHA-1 scheme', `Authorization: SCRAM-SHA-1 data=${TEST_CREDENTIAL}\nnext`, 'Authorization=[REDACTED]\nnext'],
    ['a SCRAM-SHA-256 scheme', `Authorization: SCRAM-SHA-256 data=${TEST_CREDENTIAL}\nnext`, 'Authorization=[REDACTED]\nnext'],
    ['a header line ending in CRLF', `Authorization: Digest response="${TEST_CREDENTIAL}"\r\nHost: bank`, 'Authorization=[REDACTED]\r\nHost: bank'],
    ['a line folded onto a space', `Authorization: Digest\n username="leumi-user", response="${TEST_CREDENTIAL}"\nnext`, 'Authorization=[REDACTED]\nnext'],
    ['a line folded onto a tab after CRLF', `Authorization: Digest\r\n\tusername="leumi-user", response="${TEST_CREDENTIAL}"\r\nHost: bank`, 'Authorization=[REDACTED]\r\nHost: bank'],
    ['a folded line that starts with a mark', `Authorization: Digest username="u",\n\u200e response="${TEST_CREDENTIAL}"\nnext`, 'Authorization=[REDACTED]\nnext'],
    ['a blank line after the header', `Authorization: Digest response="${TEST_CREDENTIAL}"\n\nbody`, 'Authorization=[REDACTED]\n\nbody'],
    ['a mark after the scheme', `Authorization: Digest\u200eresponse="${TEST_CREDENTIAL}"\nnext`, 'Authorization=[REDACTED]\nnext'],
    ['a mark before a plain first parameter', `Authorization: Digest\u200eusername="leumi-user", response="${TEST_CREDENTIAL}"\nnext`, 'Authorization=[REDACTED]\nnext'],
    ['a bare null, then a mark after the scheme', `token=null,authorization=Digest\u200eusername="leumi-user", response="${TEST_CREDENTIAL}"\nnext`, 'token=[REDACTED]\nnext'],
    ['a proxy header', `Proxy-Authorization: Digest response="${TEST_CREDENTIAL}"\nnext`, 'Proxy-Authorization=[REDACTED]\nnext'],
    ['a bare null, then a Digest scheme', `token=null,authorization=Digest response="${TEST_CREDENTIAL}"\nnext`, 'token=[REDACTED]\nnext'],
  ];

  it.each(PARAM_SCHEME_VALUES)('hides the rest of the line after the parameter scheme in %s', (_shape, text, expected) => {
    expect(redactSecrets(text)).toBe(expected);
  });

  const UNLISTED_SCHEME_VALUES: [string, string, string][] = [
    ['an AWS SigV4 header', `Authorization: AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20240101/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-date, Signature=${TEST_CREDENTIAL}\nnext`, 'Authorization=[REDACTED]\nnext'],
    ['a Hawk header', `Authorization: Hawk id="dh37fgj492je", ts="1353832234", mac="${TEST_CREDENTIAL}"\nnext`, 'Authorization=[REDACTED]\nnext'],
    ['a lowercase key after =', `authorization=AWS4-HMAC-SHA256 Credential=a, Signature=${TEST_CREDENTIAL}\nnext`, 'authorization=[REDACTED]\nnext'],
    ['an auth key', `auth: Custom realm="api", sig=${TEST_CREDENTIAL}\nnext`, 'auth=[REDACTED]\nnext'],
    ['a proxy header', `Proxy-Authorization: Custom sig=${TEST_CREDENTIAL}\nnext`, 'Proxy-Authorization=[REDACTED]\nnext'],
    ['spaces around the parameter\'s =', `Authorization: Custom sig = ${TEST_CREDENTIAL}\nnext`, 'Authorization=[REDACTED]\nnext'],
    ['a line folded onto a space', `Authorization: AWS4-HMAC-SHA256\n Credential=a, Signature=${TEST_CREDENTIAL}\nnext`, 'Authorization=[REDACTED]\nnext'],
    ['a line ending in CRLF', `Authorization: Hawk mac="${TEST_CREDENTIAL}"\r\nHost: bank`, 'Authorization=[REDACTED]\r\nHost: bank'],
    ['a mark after the scheme', `Authorization: AWS4-HMAC-SHA256\u200eCredential=a, Signature=${TEST_CREDENTIAL}\nnext`, 'Authorization=[REDACTED]\nnext'],
    ['a U+FEFF after the scheme', `Authorization: AWS4-HMAC-SHA256\ufeffCredential=a, Signature=${TEST_CREDENTIAL}\nnext`, 'Authorization=[REDACTED]\nnext'],
    ['a mark in the parameter\'s name', `Authorization: AWS4-HMAC-SHA256 Cred\u200eential=a, Signature=${TEST_CREDENTIAL}\nnext`, 'Authorization=[REDACTED]\nnext'],
    ['a mark before the parameter\'s =', `Authorization: AWS4-HMAC-SHA256 Credential\u200e=a, Signature=${TEST_CREDENTIAL}\nnext`, 'Authorization=[REDACTED]\nnext'],
    ['a folded line that starts with a mark', `Authorization: AWS4-HMAC-SHA256 Credential=a,\n\u200e Signature=${TEST_CREDENTIAL}\nnext`, 'Authorization=[REDACTED]\nnext'],
    ['a folded line before the parameter\'s =', `Authorization: AWS4-HMAC-SHA256 Credential\r\n\t=a, Signature=${TEST_CREDENTIAL}\r\nnext`, 'Authorization=[REDACTED]\r\nnext'],
    ['marks alone, then a folded line before the =', `Authorization: AWS4-HMAC-SHA256\u200eCredential\n\u200e =a, Signature=${TEST_CREDENTIAL}\nnext`, 'Authorization=[REDACTED]\nnext'],
    ['a bare null, then an unlisted scheme', `token=null,authorization=AWS4-HMAC-SHA256 Credential=a, Signature=${TEST_CREDENTIAL}\nnext`, 'token=[REDACTED]\nnext'],
    ['a quoted key before a bare value', `"authorization": Hawk mac=${TEST_CREDENTIAL}\nnext`, '"authorization=[REDACTED]\nnext'],
    ['a space before the colon', `Authorization : Hawk mac=${TEST_CREDENTIAL}\nnext`, 'Authorization=[REDACTED]\nnext'],
    ['a scheme that starts with an underscore', `Authorization: _Custom sig=${TEST_CREDENTIAL}\nnext`, 'Authorization=[REDACTED]\nnext'],
    ['a + in the parameter\'s name', `Authorization: Custom sig+alg=a, Signature=${TEST_CREDENTIAL}\nnext`, 'Authorization=[REDACTED]\nnext'],
    ['a ! in the scheme\'s name', `Authorization: Cus!tom sig=a, Signature=${TEST_CREDENTIAL}\nnext`, 'Authorization=[REDACTED]\nnext'],
    ['a scheme that starts with a digit', `Authorization: 4Custom sig=a, Signature=${TEST_CREDENTIAL}\nnext`, 'Authorization=[REDACTED]\nnext'],
  ];

  it.each(UNLISTED_SCHEME_VALUES)('hides the rest of the line after an unlisted scheme with parameters in %s', (_shape, text, expected) => {
    expect(redactSecrets(text)).toBe(expected);
  });

  it.each([
    ['a listed one-word scheme', `authorization: Token ${TEST_CREDENTIAL}== bank=leumi`, 'authorization=[REDACTED] bank=leumi'],
    ['a bare token holding a =', `authorization: ${TEST_CREDENTIAL}=x bank=leumi`, 'authorization=[REDACTED] bank=leumi'],
    ['a quoted value', `{"authorization":"AWS4-HMAC-SHA256 Credential=a, Signature=${TEST_CREDENTIAL}","bank":"leumi"}`, '{"authorization":"[REDACTED]","bank":"leumi"}'],
    ['a key that is not an auth header', `token=${TEST_CREDENTIAL} bank=leumi`, 'token=[REDACTED] bank=leumi'],
    ['a name that only ends in auth', 'twoFactorAuth=Custom sig=x', 'twoFactorAuth=Custom sig=x'],
    ['a chained name that only ends in auth', 'token=null,twoFactorAuth=Custom sig=x', 'token=[REDACTED] sig=x'],
    ['a word with no parameter after it', 'auth: required for this bank', 'auth=[REDACTED] for this bank'],
  ])('keeps what follows the value of %s', (_shape, text, expected) => {
    expect(redactSecrets(text)).toBe(expected);
  });

  it.each([
    ['a longer word', 'authorization: Digests pending retry', 'authorization=[REDACTED] pending retry'],
    ['a longer scheme name', 'authorization: SCRAM-SHA-10 pending retry', 'authorization=[REDACTED] pending retry'],
    ['a longer word before a separator', 'secret=Digests:"blue river" next', 'secret="[REDACTED]" next'],
  ])('hides only the first word when it merely starts like a parameter scheme: %s', (_shape, text, expected) => {
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

  it.each([...WHOLE_VALUES, ...CHAINED_VALUES, ...SEPARATOR_VALUES, ...PHONE_VALUES, ...INVISIBLE_VALUES, ...SCHEME_VALUES, ...PARAM_SCHEME_VALUES, ...UNLISTED_SCHEME_VALUES])(
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

  it.each(['_', 'a_', 'a-', 'token="\\', 'token: ', 'token:\n', 'token: a: ', 'phone_', 'aphone-', 'phonenumber', 'token:\u200e ', 'token=\u200e', 'token=a:\u200e'])('scans a long run of %j in linear time', (unit) => {
    const text = unit.repeat(100_000);
    expect(fastestRunMs(() => redactSecrets(text))).toBeLessThan(LINEAR_LIMIT_MS);
  });

  it.each(['1 ', '(+1', '1-', '1\u00a0', '- ', '1x ', '\u200e1 ', '(\u2066'])('scans a long phone value of %j in linear time', (unit) => {
    const text = `phoneNumber=${unit.repeat(100_000)}x tail`;
    expect(fastestRunMs(() => redactSecrets(text))).toBeLessThan(LINEAR_LIMIT_MS);
  });

  it.each(['\n ', ' ', '\u200e', '\ufeff', '\n\u200e x', '\u200e x', 'x\u200e'])('scans a long gap of %j after an auth scheme in linear time', (unit) => {
    const text = `authorization=a${unit.repeat(100_000)}`;
    expect(fastestRunMs(() => redactSecrets(text))).toBeLessThan(LINEAR_LIMIT_MS);
  });

  it('scans a long run of invisible marks after a key in linear time', () => {
    const text = `token=${'\u200e'.repeat(20_000)} `;
    expect(fastestRunMs(() => redactSecrets(text))).toBeLessThan(LINEAR_LIMIT_MS);
  });

  it.each(['token="', String.raw`token=\"`])('scans a long run of backslashes after %j in linear time', (opening) => {
    const text = `${opening}${'\\'.repeat(100_000)} tail`;
    expect(fastestRunMs(() => redactSecrets(text))).toBeLessThan(LINEAR_LIMIT_MS);
  });

  it.each(['toke\u200e', '\u200eauth', 'phone-\u200e', 'idTok\u200een ', 'token"\u200e ', '"auth\u200e"\u200e: '])('scans a long run of %j, with marks in or after a key, in linear time', (unit) => {
    const text = unit.repeat(100_000);
    expect(fastestRunMs(() => redactSecrets(text))).toBeLessThan(LINEAR_LIMIT_MS);
  });

  it.each(['phone', 'phone_', 'tok', 'auth', 'authorization: A'])('scans a long run of invisible marks after %j in linear time', (start) => {
    const text = `${start}${'\u200e'.repeat(20_000)}x`;
    expect(fastestRunMs(() => redactSecrets(text))).toBeLessThan(LINEAR_LIMIT_MS);
  });

  it.each(['A\u200e\u200e', 'A\ufeff\ufeff', 'Bea\u200e', 'Di\u200e', 'x\u200e ', 'A\ufeff ', 'A \n\t', 'A\u200e\n ', 'Credential\r\n\t', '!\u200e\u200e', '4\u200e'])('scans a long auth value of %j, with marks in its scheme, in linear time', (unit) => {
    const text = `authorization: ${unit.repeat(100_000)}`;
    expect(fastestRunMs(() => redactSecrets(text))).toBeLessThan(LINEAR_LIMIT_MS);
  });

  it.each(['phone\u200e', 'auth\u200e', 't\u200e'])('reads a long field name of %j in linear time', (unit) => {
    const name = unit.repeat(100_000);
    expect(fastestRunMs(() => isSecretKey(name))).toBeLessThan(LINEAR_LIMIT_MS);
  });

  it.each([
    'AuthenticationError: bank rejected the login',
    'tokenize: step failed',
    'maxTokens: 5',
    'author: someone',
    'OAuth: provider unavailable',
    'phoneNumberCount: 3',
    'Set twoFactorAuth: true for this bank and configure Telegram or the mobile app',
    'Config portal on http://127.0.0.1:3000 (auth mode: password)',
    '',
  ])('leaves %j unchanged', (text) => {
    expect(redactSecrets(text)).toBe(text);
  });
});
