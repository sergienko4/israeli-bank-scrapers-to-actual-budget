import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, readdirSync, readFileSync, unlinkSync, rmdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import FileLogger from '../../src/Logger/FileLogger.js';
import { TEST_CREDENTIAL } from '../helpers/testCredentials.js';

let testDir: string;

function clearDir(dir: string): void {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    try { unlinkSync(join(dir, f)); } catch { /* ignore */ }
  }
  try { rmdirSync(dir); } catch { /* ignore */ }
}

// LogRotatingStream writes through fs.createWriteStream, which opens the file
// asynchronously. Neither the file nor its contents exist at a predictable
// moment, so these tests wait on observed state instead of a guessed delay.
// A fixed 50ms sleep used to gate these assertions and failed on a loaded
// machine (2026-08-23: "expected [] to have a length of 1 but got +0").
const POLL_INTERVAL_MS = 10;
const WAIT_TIMEOUT_MS = 5_000;

/**
 * Polls until the probe reports readiness, or fails once the deadline passes.
 * @param probe - Returns the observed value, or undefined while not yet ready.
 * @param expectation - Description of what is awaited, used in the timeout message.
 * @returns The first defined value the probe returns.
 */
async function waitFor<T>(probe: () => T | undefined, expectation: string): Promise<T> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    const observed = probe();
    if (observed !== undefined) return observed;
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out after ${String(WAIT_TIMEOUT_MS)}ms waiting for ${expectation}`);
}

/**
 * Waits until the rotating stream has created its log file on disk.
 * @returns The directory listing, which contains at least one entry.
 */
async function waitForLogFile(): Promise<string[]> {
  return waitFor(() => {
    const files = readdirSync(testDir);
    return files.length > 0 ? files : undefined;
  }, 'the log file to be created');
}

/**
 * Waits until at least one complete NDJSON line has been flushed to the file.
 * @returns The log file contents, containing at least one terminated line.
 */
async function waitForLogContent(): Promise<string> {
  return waitFor(() => {
    const content = readLogContent();
    return content.includes('\n') ? content : undefined;
  }, 'a complete log line to be written');
}

beforeEach(() => {
  testDir = join(tmpdir(), `filelogger-test-${randomUUID()}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  clearDir(testDir);
});

function readLogContent(): string {
  const files = readdirSync(testDir);
  if (files.length === 0) return '';
  return readFileSync(join(testDir, files[0]), 'utf8');
}

describe('FileLogger', () => {
  it('creates a log file on first write', async () => {
    const logger = new FileLogger(testDir);
    logger.info('hello');
    expect(await waitForLogFile()).toHaveLength(1);
  });

  it('writes info messages as valid JSON lines', async () => {
    const logger = new FileLogger(testDir);
    logger.info('test message');
    const content = await waitForLogContent();
    const line = content.trim().split('\n')[0];
    const entry = JSON.parse(line);
    expect(entry.msg).toBe('test message');
    expect(entry.level).toBe(30); // pino info level
  });

  it('writes debug messages (level 20)', async () => {
    const logger = new FileLogger(testDir);
    logger.debug('debug msg');
    const entry = JSON.parse((await waitForLogContent()).trim());
    expect(entry.level).toBe(20);
    expect(entry.msg).toBe('debug msg');
  });

  it('writes warn messages (level 40)', async () => {
    const logger = new FileLogger(testDir);
    logger.warn('warning');
    const entry = JSON.parse((await waitForLogContent()).trim());
    expect(entry.level).toBe(40);
  });

  it('writes error messages (level 50)', async () => {
    const logger = new FileLogger(testDir);
    logger.error('failure');
    const entry = JSON.parse((await waitForLogContent()).trim());
    expect(entry.level).toBe(50);
    expect(entry.msg).toBe('failure');
  });

  it('includes context fields in JSON output', async () => {
    const logger = new FileLogger(testDir);
    logger.info('import done', { bank: 'discount', count: 5 });
    const entry = JSON.parse((await waitForLogContent()).trim());
    expect(entry.bank).toBe('discount');
    expect(entry.count).toBe(5);
  });

  it('redacts sensitive fields', async () => {
    const logger = new FileLogger(testDir);
    logger.info('login', { password: TEST_CREDENTIAL });
    const entry = JSON.parse((await waitForLogContent()).trim());
    expect(entry.password).toBe('[REDACTED]');
  });
});
