/**
 * Long-term token redaction tests.
 *
 * Scraper 8.7.2 hands API-direct banks a durable login token under three
 * names: `otpLongTermToken` (credentials), `longTermToken` (the
 * `onAuthFlowComplete` payload) and `persistentOtpToken` (the result). It is
 * minted as an `idToken` and delivered next to the session `bearer`. Each
 * written line is masked by the text masker's key rule, so every alias must be
 * hidden wherever it sits, or a logged object carries a years-long bypass of
 * the SMS factor in clear text.
 */
import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { baseOptions, redactLogLine } from '../../src/Logger/LoggerOptions.js';
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

/**
 * Writes one entry through a logger built from the shared base options.
 * @param write - Logs one entry on the logger it is given.
 * @returns The serialised line exactly as a transport would receive it.
 */
function writeOnce(write: (logger: pino.Logger) => unknown): string {
  const lines: string[] = [];
  const sink = { write: (line: string): number => lines.push(line) };
  write(pino({ ...baseOptions(), level: 'info' }, sink));
  expect(lines).toHaveLength(1);
  return lines.join('');
}

describe('secrets anywhere in a written line', () => {
  const RULE_KEYS = ['authToken', 'Authorization', 'clientSecret', 'refresh_token', 'x-auth-token'];

  it.each(RULE_KEYS)('redacts %s bound to a child logger', (key) => {
    const line = writeOnce((logger) => logger.child({ [key]: TEST_CREDENTIAL }).info('event'));
    expect(line).not.toContain(TEST_CREDENTIAL);
    expect(JSON.parse(line)[key]).toBe('[REDACTED]');
  });

  it.each(RULE_KEYS)('redacts %s nested in a child binding', (key) => {
    const line = writeOnce((logger) => logger.child({ session: { [key]: TEST_CREDENTIAL } }).info('event'));
    expect(line).not.toContain(TEST_CREDENTIAL);
    expect(JSON.parse(line).session[key]).toBe('[REDACTED]');
  });

  it.each(RULE_KEYS)('redacts %s one level down, as in logged headers', (key) => {
    const line = logOnce({ headers: { [key]: TEST_CREDENTIAL } }, 'event');
    expect(line).not.toContain(TEST_CREDENTIAL);
    expect(JSON.parse(line).headers[key]).toBe('[REDACTED]');
  });

  it.each([...TOKEN_ALIASES, ...RULE_KEYS])('redacts %s three levels down', (key) => {
    const line = logOnce({ a: { b: { c: { [key]: TEST_CREDENTIAL } } } }, 'event');
    expect(line).not.toContain(TEST_CREDENTIAL);
    expect(JSON.parse(line).a.b.c[key]).toBe('[REDACTED]');
  });

  it('redacts a secret key inside a list of objects', () => {
    const line = logOnce({ sessions: [{ bankId: 'oneZero', idToken: TEST_CREDENTIAL }] }, 'event');
    expect(JSON.parse(line).sessions).toEqual([{ bankId: 'oneZero', idToken: '[REDACTED]' }]);
  });

  it('masks a secret quoted in a list of texts', () => {
    const line = logOnce({ notes: [`idToken=${TEST_CREDENTIAL}`, 'retrying'] }, 'event');
    expect(JSON.parse(line).notes).toEqual(['idToken=[REDACTED]', 'retrying']);
  });

  it('masks a secret quoted in the text of a child binding', () => {
    const reply = `{"idToken":"${TEST_CREDENTIAL}"}`;
    const line = writeOnce((logger) => logger.child({ reply }).info('event'));
    expect(JSON.parse(line).reply).toBe('{"idToken":"[REDACTED]"}');
  });

  it('masks a secret quoted in nested text', () => {
    const line = logOnce({ response: { body: `{"idToken":"${TEST_CREDENTIAL}"}` } }, 'event');
    expect(JSON.parse(line).response.body).toBe('{"idToken":"[REDACTED]"}');
  });

  it('hides a whole object held under a secret key', () => {
    const line = logOnce({ headers: { auth: { user: 'dana', pin: TEST_CREDENTIAL } } }, 'event');
    expect(line).not.toContain(TEST_CREDENTIAL);
    expect(JSON.parse(line).headers.auth).toBe('[REDACTED]');
  });

  it('hides a number held under a secret key', () => {
    const line = logOnce({ result: { token: 482913 } }, 'event');
    expect(line).not.toContain('482913');
    expect(JSON.parse(line).result.token).toBe('[REDACTED]');
  });

  it('keeps a null field and the fields after a hidden object', () => {
    const line = logOnce({ closed: null, headers: { auth: { user: 'dana' } }, bankId: 'oneZero' }, 'event');
    expect(JSON.parse(line)).toMatchObject({ closed: null, headers: { auth: '[REDACTED]' }, bankId: 'oneZero' });
  });

  it.each(['phoneNumber', 'PhoneNumber', 'phone_number', 'userPhoneNumber'])(
    'hides a phone number under %s at any depth',
    (key) => {
      const line = logOnce({ phoneNumber: 'phone-on-file', a: { b: { [key]: 'phone-on-file' } } }, 'event');
      expect(line).not.toContain('phone-on-file');
      expect(JSON.parse(line).a.b[key]).toBe('[REDACTED]');
    },
  );

  it('hides a phone number bound to a child logger', () => {
    const line = writeOnce((logger) => logger.child({ login: { phoneNumber: 'phone-on-file' } }).info('event'));
    expect(JSON.parse(line).login.phoneNumber).toBe('[REDACTED]');
  });

  it('masks a secret written into a field name', () => {
    const line = logOnce({ [`idToken=${TEST_CREDENTIAL}`]: 'metadata' }, 'event');
    expect(line).not.toContain(TEST_CREDENTIAL);
    expect(JSON.parse(line)['idToken=[REDACTED]']).toBe('metadata');
  });

  it('keeps a whole number too large for a double exactly as pino wrote it', () => {
    const line = writeOnce((logger) => logger.info({ count: 9007199254740993n, rate: 1.5 }, 'event'));
    expect(line).toContain('"count":9007199254740993,"rate":1.5');
  });

  it('hides a whole number too large for a double under a secret key', () => {
    const line = writeOnce((logger) => logger.info({ result: { token: 9007199254740993n } }, 'event'));
    expect(line).not.toContain('9007199254740993');
    expect(JSON.parse(line).result.token).toBe('[REDACTED]');
  });

  it('masks a secret a logged Error quotes in its message', () => {
    const text = `POST /sessions 401: {"idToken":"${TEST_CREDENTIAL}"}`;
    const line = writeOnce((logger) => logger.error(new Error(text)));
    expect(line).not.toContain(TEST_CREDENTIAL);
    expect(JSON.parse(line).err.message).toBe('POST /sessions 401: {"idToken":"[REDACTED]"}');
  });

  it('redacts a secret field a logged Error carries', () => {
    const error = Object.assign(new Error('boom'), { authToken: TEST_CREDENTIAL });
    const line = writeOnce((logger) => logger.error(error, 'failed'));
    expect(line).not.toContain(TEST_CREDENTIAL);
    expect(JSON.parse(line).err).toMatchObject({ message: 'boom', authToken: '[REDACTED]' });
  });

  it('writes a context that refers to itself without its secret', () => {
    const fields: Record<string, unknown> = { authToken: TEST_CREDENTIAL };
    fields.self = fields;
    const line = logOnce(fields, 'event');
    expect(line).not.toContain(TEST_CREDENTIAL);
    expect(JSON.parse(line).authToken).toBe('[REDACTED]');
  });

  it('keeps ordinary nested fields and lists exactly', () => {
    const bank = { id: 'oneZero', counts: [1, 2.5], active: true, closed: null, label: 'token count' };
    expect(JSON.parse(logOnce({ bank }, 'event')).bank).toEqual(bank);
  });

  it('hides a phone number when pino writes a line that is not JSON', () => {
    const fields = { constructor: 'metadata', phoneNumber: 'phone-on-file', authToken: TEST_CREDENTIAL };
    const line = logOnce(fields, 'event');
    expect(line).not.toContain('phone-on-file');
    expect(line).not.toContain(TEST_CREDENTIAL);
  });

  it('writes one JSON line ending in a newline', () => {
    const line = logOnce({ result: { idToken: TEST_CREDENTIAL } }, 'event');
    expect(line.endsWith('}\n')).toBe(true);
    expect(line.indexOf('\n')).toBe(line.length - 1);
  });
});

describe('redactLogLine', () => {
  it('keeps the line ending pino wrote', () => {
    const line = redactLogLine(`{"token":"${TEST_CREDENTIAL}"}\r\n`);
    expect(line).toBe('{"token":"[REDACTED]"}\r\n');
  });

  it.each([
    '12345678901234567890', '-12345678901234567890', '1e+21', '0.1', '9007199254740991', '1e3', '-0',
    '1.0', '0.1000000000000000055511',
  ])(
    'writes the number %s back exactly',
    (lexeme) => {
      const line = `{"list":[${lexeme}],"n":${lexeme}}\n`;
      expect(redactLogLine(line)).toBe(line);
    },
  );

  it('hides a spaced phone number in a message', () => {
    const line = logOnce({}, 'login failed for phoneNumber=+972 50-000-0016, retry');
    expect(line).toContain('phoneNumber=[REDACTED] retry');
  });

  it('masks a phone number split by no-break spaces in a line that is not JSON', () => {
    expect(redactLogLine('login phoneNumber=050\u00a0123\u00a04567! failed\n')).toBe('login phoneNumber=[REDACTED] failed\n');
  });

  it('masks a phone number in bidi isolates in a line that is not JSON', () => {
    expect(redactLogLine('login phone_number=\u2066+972 50-123-4567\u2069 failed\n')).toBe('login phone_number=[REDACTED] failed\n');
  });

  it('masks a phone number in a line that is not JSON as text', () => {
    expect(redactLogLine('login phoneNumber=phone-on-file failed\n')).toBe('login phoneNumber=[REDACTED] failed\n');
  });

  it('masks a phone number written into a field name', () => {
    expect(redactLogLine('{"phoneNumber=phone-on-file":1}\n')).toBe('{"phoneNumber=[REDACTED]":1}\n');
  });

  it('masks a line too deep to walk as text', () => {
    const depth = 50_000;
    const line = `${'{"a":'.repeat(depth)}{"phoneNumber":"phone-on-file","idToken":"${TEST_CREDENTIAL}"}${'}'.repeat(depth)}\n`;
    const masked = redactLogLine(line);
    expect(masked).not.toContain('phone-on-file');
    expect(masked).not.toContain(TEST_CREDENTIAL);
  });

  it('masks a line that is not JSON as text', () => {
    expect(redactLogLine(`idToken=${TEST_CREDENTIAL}\n`)).toBe('idToken=[REDACTED]\n');
  });

  it('redacts a secret under an own __proto__ key and keeps the key', () => {
    const line = redactLogLine(`{"__proto__":{"token":"${TEST_CREDENTIAL}"}}\n`);
    expect(line).toBe('{"__proto__":{"token":"[REDACTED]"}}\n');
  });

  it('hides a value by the name the caller wrote, before masking it', () => {
    const line = redactLogLine(`{"token=\\"abc authToken":"${TEST_CREDENTIAL}"}\n`);
    expect(line).toBe('{"token=[REDACTED]":"[REDACTED]"}\n');
  });

  it('leaves its own output unchanged', () => {
    const once = redactLogLine(`{"a":{"authToken":"x"},"msg":"idToken=${TEST_CREDENTIAL} ok"}\n`);
    expect(redactLogLine(once)).toBe(once);
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

  it('hides the credential after a Token scheme a bank echoed', () => {
    const line = logOnce({}, `Pipeline failed: 401: Authorization: Token ${TEST_CREDENTIAL} rejected`);
    expect(line).not.toContain(TEST_CREDENTIAL);
    expect(JSON.parse(line).msg).toBe('Pipeline failed: 401: Authorization=[REDACTED] rejected');
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
