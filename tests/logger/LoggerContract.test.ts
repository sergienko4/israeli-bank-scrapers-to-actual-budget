import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pino from 'pino';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLogger } from '../../src/Logger/Index.js';
import type { ILogger, LogContext } from '../../src/Logger/ILogger.js';
import LogMediator from '../../src/Logger/LogMediator.js';
import PinoAdapter from '../../src/Logger/PinoAdapter.js';
import type { LogFormat } from '../../src/Types/Index.js';
import { TEST_CREDENTIAL } from '../helpers/testCredentials.js';

/** Every line any logger in this file hands to its destination. */
const written = vi.hoisted(() => [] as string[]);

vi.mock('pino', async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof pino }>();
  const sink = { write: (line: string): boolean => written.push(line) > 0 };
  /**
   * Builds a real pino logger that writes to the capture sink, whatever
   * destination the caller asked for, so the options it passes decide the line.
   * @param options - The options the logger under test was built with.
   * @returns A pino logger with those options.
   */
  const capturing = (options?: pino.LoggerOptions): pino.Logger => actual.default(options ?? {}, sink);
  return { ...actual, default: Object.assign(capturing, actual.default) };
});

// The capture sink replaces every destination, so the log file is never written.
vi.mock('../../src/Logger/LogRotatingStream.js', () => ({ default: class {} }));

const LOG_DIR = mkdtempSync(join(tmpdir(), 'logger-contract-'));
const FORMATS: readonly LogFormat[] = ['words', 'json', 'table', 'phone'];
const originalLevel = process.env.LOG_LEVEL;

/** Each logger the importer can run with, built the way production builds it. */
const LOGGERS: readonly [string, () => ILogger, new (...args: never[]) => ILogger, number][] = FORMATS.flatMap(
  format => [
    [`${format} to the console`, () => createLogger({ format }), PinoAdapter, 1],
    [`${format} to the console and a log file`, () => createLogger({ format, logDir: LOG_DIR }), LogMediator, 2],
  ] as const,
);

/** Messages that quote a credential the way a failed login or a reply would. */
const SECRET_MESSAGES: readonly string[] = [
  `login failed: idToken=${TEST_CREDENTIAL}`,
  `POST /sessions 401: {"otpLongTermToken":"${TEST_CREDENTIAL}"}`,
  `retrying with Authorization: Bearer ${TEST_CREDENTIAL}`,
  `✖ Step [login] failed: rejected | cause: Error: reply {"idToken":"${TEST_CREDENTIAL}"}\n    at login (x.js:1:1)`,
];

/** Context fields that carry a credential, under the names providers use. */
const SECRET_CONTEXTS: readonly LogContext[] = [
  { idToken: TEST_CREDENTIAL },
  { bank: 'oneZero', otpLongTermToken: TEST_CREDENTIAL },
];

/** The four methods of the logger port. */
const LEVELS = ['debug', 'info', 'warn', 'error'] as const;

/**
 * Sends every secret case through every method of one logger.
 * @param logger - The logger under test.
 * @returns Nothing; the lines land in the capture sink.
 */
function logEverySecret(logger: ILogger): void {
  for (const level of LEVELS) {
    for (const message of SECRET_MESSAGES) logger[level](message);
    for (const context of SECRET_CONTEXTS) logger[level]('contract-event', context);
  }
}

describe('every logger masks what it is given', () => {
  beforeEach(() => {
    process.env.LOG_LEVEL = 'debug';
    written.length = 0;
  });

  afterEach(() => {
    if (originalLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = originalLevel;
  });

  afterAll(() => {
    rmSync(LOG_DIR, { recursive: true, force: true });
  });

  it.each(LOGGERS)('%s', (_name, build, kind, outputs) => {
    const logger = build();
    written.length = 0;
    logEverySecret(logger);

    expect(logger).toBeInstanceOf(kind);
    expect(written).toHaveLength(LEVELS.length * (SECRET_MESSAGES.length + SECRET_CONTEXTS.length) * outputs);
    expect(written.join('\n')).not.toContain(TEST_CREDENTIAL);
  });
});
