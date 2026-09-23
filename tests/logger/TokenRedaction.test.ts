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
});
