import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, readdirSync, readFileSync, unlinkSync, rmdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { FileLogger } from '../../src/Logger/FileLogger.js';
import { TEST_CREDENTIAL } from '../helpers/testCredentials.js';

let testDir: string;

function clearDir(dir: string): void {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    try { unlinkSync(join(dir, f)); } catch { /* ignore */ }
  }
  try { rmdirSync(dir); } catch { /* ignore */ }
}

async function flush(ms = 50): Promise<void> {
  return new Promise(res => setTimeout(res, ms));
}

beforeEach(() => {
  testDir = join(tmpdir(), `filelogger-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(async () => {
  await flush();
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
    await flush();
    expect(readdirSync(testDir)).toHaveLength(1);
  });

  it('writes info messages as valid JSON lines', async () => {
    const logger = new FileLogger(testDir);
    logger.info('test message');
    await flush();
    const content = readLogContent();
    const line = content.trim().split('\n')[0];
    const entry = JSON.parse(line);
    expect(entry.msg).toBe('test message');
    expect(entry.level).toBe(30); // pino info level
  });

  it('writes debug messages (level 20)', async () => {
    const logger = new FileLogger(testDir);
    logger.debug('debug msg');
    await flush();
    const entry = JSON.parse(readLogContent().trim());
    expect(entry.level).toBe(20);
    expect(entry.msg).toBe('debug msg');
  });

  it('writes warn messages (level 40)', async () => {
    const logger = new FileLogger(testDir);
    logger.warn('warning');
    await flush();
    const entry = JSON.parse(readLogContent().trim());
    expect(entry.level).toBe(40);
  });

  it('writes error messages (level 50)', async () => {
    const logger = new FileLogger(testDir);
    logger.error('failure');
    await flush();
    const entry = JSON.parse(readLogContent().trim());
    expect(entry.level).toBe(50);
    expect(entry.msg).toBe('failure');
  });

  it('includes context fields in JSON output', async () => {
    const logger = new FileLogger(testDir);
    logger.info('import done', { bank: 'discount', count: 5 });
    await flush();
    const entry = JSON.parse(readLogContent().trim());
    expect(entry.bank).toBe('discount');
    expect(entry.count).toBe(5);
  });

  it('redacts sensitive fields', async () => {
    const logger = new FileLogger(testDir);
    logger.info('login', { password: TEST_CREDENTIAL });
    await flush();
    const entry = JSON.parse(readLogContent().trim());
    expect(entry.password).toBe('[REDACTED]');
  });
});
