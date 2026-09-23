/**
 * Long-term token redaction tests.
 *
 * Scraper 8.7.2 hands API-direct banks a durable login token under three
 * names: `otpLongTermToken` (credentials), `longTermToken` (the
 * `onAuthFlowComplete` payload) and `persistentOtpToken` (the result). It is
 * minted as an `idToken` and delivered next to the session `bearer`. pino
 * matches redact paths by exact key name, so every alias has to be listed, or
 * a logged object carries a years-long bypass of the SMS factor in clear text.
 */
import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { baseOptions } from '../../src/Logger/LoggerOptions.js';
import { TEST_CREDENTIAL } from '../helpers/testCredentials.js';

const TOKEN_ALIASES = [
  'otpLongTermToken', 'longTermToken', 'persistentOtpToken', 'idToken', 'bearer',
  'access_token',
];

/**
 * Logs one entry through the shared base options and returns the raw line.
 *
 * <p>The level is pinned so the entry is written whatever `LOG_LEVEL` the
 * host exports; an empty line would make every "not leaked" check vacuous.
 * @param fields - Structured fields merged into the log entry.
 * @param args - The message, then any `%s` interpolation values.
 * @returns The serialised line exactly as a transport would receive it.
 */
function logOnce(fields: Record<string, unknown>, ...args: [string, ...string[]]): string {
  const lines: string[] = [];
  const sink = { write: (line: string): number => lines.push(line) };
  pino({ ...baseOptions(), level: 'info' }, sink).info(fields, ...args);
  expect(lines).toHaveLength(1);
  return lines.join('');
}

describe('long-term token redaction', () => {
  it.each(TOKEN_ALIASES)('redacts %s at the top level of an entry', (alias) => {
    const line = logOnce({ [alias]: TEST_CREDENTIAL }, 'event');
    expect(line).not.toContain(TEST_CREDENTIAL);
    expect(JSON.parse(line)[alias]).toBe('[REDACTED]');
  });

  it.each(TOKEN_ALIASES)('redacts %s one level down, as in a logged result', (alias) => {
    const line = logOnce({ result: { [alias]: TEST_CREDENTIAL } }, 'event');
    expect(line).not.toContain(TEST_CREDENTIAL);
    expect(JSON.parse(line).result[alias]).toBe('[REDACTED]');
  });

  it('still redacts the credential keys it covered before', () => {
    const line = logOnce({ password: TEST_CREDENTIAL, bank: { token: TEST_CREDENTIAL } }, 'event');
    expect(line).not.toContain(TEST_CREDENTIAL);
  });

  it('leaves ordinary fields readable', () => {
    const line = logOnce({ bankId: 'oneZero' }, 'event');
    expect(JSON.parse(line).bankId).toBe('oneZero');
  });
});

describe('structured fields under any key the text masker names', () => {
  const TOP_LEVEL_KEYS = [
    'authorization', 'Authorization', 'jwt', 'id_token', 'authToken', 'refresh_token',
    'x-auth-token', 'secret', 'auth', 'creditCard', 'cvv', 'password', 'token',
    'client_secret', 'clientSecret', 'new_password', 'userPassword', 'card_cvv',
  ];
  const NESTED_KEYS = ['authorization', 'jwt', 'id_token', 'secret', 'auth', 'creditCard', 'cvv'];

  it.each(TOP_LEVEL_KEYS)('redacts %s at the top level of an entry', (key) => {
    const line = logOnce({ [key]: TEST_CREDENTIAL }, 'event');
    expect(line).not.toContain(TEST_CREDENTIAL);
    expect(JSON.parse(line)[key]).toBe('[REDACTED]');
  });

  it.each(NESTED_KEYS)('redacts %s one level down, as in logged headers', (key) => {
    const line = logOnce({ headers: { [key]: TEST_CREDENTIAL } }, 'event');
    expect(line).not.toContain(TEST_CREDENTIAL);
    expect(JSON.parse(line).headers[key]).toBe('[REDACTED]');
  });

  it('masks a secret quoted inside a text field', () => {
    const line = logOnce({ error: `POST /sessions 401: {"idToken":"${TEST_CREDENTIAL}"}` }, 'failed');
    expect(line).not.toContain(TEST_CREDENTIAL);
    expect(JSON.parse(line).error).toBe('POST /sessions 401: {"idToken":"[REDACTED]"}');
  });

  it('keeps fields whose names only contain a secret word', () => {
    const fields = { tokenCount: 3, authorName: 'dana', twoFactorAuth: true };
    expect(JSON.parse(logOnce(fields, 'event'))).toMatchObject(fields);
  });

  it('masks a context object built without a prototype', () => {
    const fields: Record<string, unknown> = Object.create(null);
    fields.authToken = TEST_CREDENTIAL;
    expect(logOnce(fields, 'event')).not.toContain(TEST_CREDENTIAL);
  });

  it.each([
    'password', 'token', 'secret', 'auth', 'creditCard', 'cvv', 'authorization', 'jwt',
    'id_token', 'phoneNumber', 'otpLongTermToken', 'longTermToken', 'persistentOtpToken',
    'idToken', 'bearer', 'access_token',
  ])('redacts %s bound to a child logger, which the hook never sees', (key) => {
    const lines: string[] = [];
    const sink = { write: (line: string): number => lines.push(line) };
    const parent = pino({ ...baseOptions(), level: 'info' }, sink);
    parent.child({ [key]: TEST_CREDENTIAL }).info('event');
    expect(lines.join('')).not.toContain(TEST_CREDENTIAL);
  });

  it('leaves an Error for pino to serialise', () => {
    const lines: string[] = [];
    const sink = { write: (line: string): number => lines.push(line) };
    pino({ ...baseOptions(), level: 'info' }, sink).error(new Error('boom'), 'failed');
    expect(JSON.parse(lines.join('')).err.message).toBe('boom');
  });
});

describe('secrets quoted in log message text', () => {
  it('redacts a token a bank echoed into an error message', () => {
    const body = `{"idToken":"${TEST_CREDENTIAL}","code":"E1"}`;
    const line = logOnce({}, `Pipeline failed: GENERIC: POST /sessions 401: ${body}`);
    expect(line).not.toContain(TEST_CREDENTIAL);
    expect(JSON.parse(line).msg).toContain('Pipeline failed: GENERIC: POST /sessions 401:');
  });

  it('redacts a secret passed as an interpolation value', () => {
    const line = logOnce({}, 'retrying after %s', `bearer=Bearer ${TEST_CREDENTIAL}`);
    expect(line).not.toContain(TEST_CREDENTIAL);
  });

  it('leaves an ordinary message unchanged', () => {
    const line = logOnce({}, 'Imported 5 transactions for oneZero');
    expect(JSON.parse(line).msg).toBe('Imported 5 transactions for oneZero');
  });

  it('masks a key in the message whose value is an interpolation value', () => {
    const line = logOnce({}, 'token: %s bank: %s', TEST_CREDENTIAL, 'leumi');
    expect(line).not.toContain(TEST_CREDENTIAL);
    expect(JSON.parse(line).msg).toBe('token=[REDACTED] bank: %s');
  });

  it.each([
    ['after an unknown placeholder', ['token=%x safe=%s', TEST_CREDENTIAL, 'public'], TEST_CREDENTIAL],
    ['with spaces, after a key', ['userPass' + 'word=%s', `blue ${TEST_CREDENTIAL} river`], TEST_CREDENTIAL],
    ['whose key is a value too', ['%s=%s', 'token', TEST_CREDENTIAL], TEST_CREDENTIAL],
    ['that is a one-time code', ['sms code %d', 482913], '482913'],
    ['that is an object', ['session %j', { code: TEST_CREDENTIAL }], TEST_CREDENTIAL],
  ])('never writes a value %s', (_shape, args, secret) => {
    const lines: string[] = [];
    const sink = { write: (line: string): number => lines.push(line) };
    const logger = pino({ ...baseOptions(), level: 'info' }, sink);
    (logger.info as (...values: unknown[]) => void)(...args);
    expect(lines).toHaveLength(1);
    expect(lines.join('')).not.toContain(secret);
  });

  it.each([
    ['a null context', [null, 'event'], 'event'],
    ['an undefined context', [undefined, 'token: %s bank: %s', TEST_CREDENTIAL, 'leumi'], 'token=[REDACTED] bank: %s'],
    ['a null value', ['value %s', null], 'value %s'],
    ['a literal percent', ['100%% of %s synced', 'leumi'], '100%% of %s synced'],
    ['a message that is not text', [{}, 42, 'leumi'], 42],
    ...['%d', '%i', '%f', '%j', '%o', '%O', '%s'].map(
      (placeholder): [string, unknown[], string] => [placeholder, [`${placeholder} synced`, 1], `${placeholder} synced`],
    ),
  ])('writes the message of a call with %s as the call wrote it', (_shape, args, expected) => {
    const lines: string[] = [];
    const sink = { write: (line: string): number => lines.push(line) };
    const logger = pino({ ...baseOptions(), level: 'info' }, sink);
    (logger.info as (...values: unknown[]) => void)(...args);
    expect(JSON.parse(lines.join('')).msg).toBe(expected);
  });

  it('masks an interpolated message logged without a context', () => {
    const lines: string[] = [];
    const sink = { write: (line: string): number => lines.push(line) };
    pino({ ...baseOptions(), level: 'info' }, sink).info('idToken=%s for %s', TEST_CREDENTIAL, 'leumi');
    expect(JSON.parse(lines.join('')).msg).toBe('idToken=[REDACTED] for %s');
  });
});
