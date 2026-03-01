import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readdirSync, unlinkSync, rmdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { cleanOldLogs } from '../../src/Logger/LogCleanup.js';

let testDir: string;

function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function writeLog(name: string): void {
  writeFileSync(join(testDir, name), 'log content');
}

function clearDir(dir: string): void {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) unlinkSync(join(dir, f));
  rmdirSync(dir);
}

beforeEach(() => {
  testDir = join(tmpdir(), `logcleanup-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => clearDir(testDir));

describe('cleanOldLogs', () => {
  it('deletes files older than 3 days', () => {
    writeLog(`app.${daysAgo(4)}.log`);
    writeLog(`app.${daysAgo(5)}.log`);
    cleanOldLogs(testDir);
    expect(readdirSync(testDir)).toHaveLength(0);
  });

  it('keeps files within 3 days', () => {
    writeLog(`app.${daysAgo(2)}.log`);
    writeLog(`app.${daysAgo(1)}.log`);
    cleanOldLogs(testDir);
    expect(readdirSync(testDir)).toHaveLength(2);
  });

  it('keeps today file', () => {
    writeLog(`app.${daysAgo(0)}.log`);
    cleanOldLogs(testDir);
    expect(readdirSync(testDir)).toHaveLength(1);
  });

  it('handles overflow suffix files', () => {
    writeLog(`app.${daysAgo(4)}.1.log`);
    writeLog(`app.${daysAgo(4)}.2.log`);
    cleanOldLogs(testDir);
    expect(readdirSync(testDir)).toHaveLength(0);
  });

  it('ignores non-log files', () => {
    writeLog('other.txt');
    writeLog(`app.${daysAgo(4)}.log`);
    cleanOldLogs(testDir);
    expect(readdirSync(testDir)).toEqual(['other.txt']);
  });

  it('is a no-op when directory does not exist', () => {
    expect(() => cleanOldLogs('/tmp/nonexistent-logclean-xyz')).not.toThrow();
  });

  it('deletes old but keeps recent in mixed directory', () => {
    writeLog(`app.${daysAgo(4)}.log`);
    writeLog(`app.${daysAgo(1)}.log`);
    cleanOldLogs(testDir);
    const remaining = readdirSync(testDir);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toContain(daysAgo(1));
  });
});
