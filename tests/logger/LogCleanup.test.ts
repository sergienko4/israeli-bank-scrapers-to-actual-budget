import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readdirSync, unlinkSync, rmdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import cleanOldLogs from '../../src/Logger/LogCleanup.js';

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

  it('returns success with no-dir status when directory does not exist', () => {
    const result = cleanOldLogs('/tmp/nonexistent-logclean-xyz');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('no-dir');
  });

  it('returns failure when directory cannot be read', () => {
    // Use a path that exists but is not a directory (a file)
    const fakePath = join(testDir, 'not-a-dir');
    writeFileSync(fakePath, 'data');
    const result = cleanOldLogs(fakePath);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.message).toContain('log cleanup failed');
  });

  it('returns cleaned status on success', () => {
    writeLog(`app.${daysAgo(4)}.log`);
    const result = cleanOldLogs(testDir);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('cleaned');
  });

  it('deletes old but keeps recent in mixed directory', () => {
    writeLog(`app.${daysAgo(4)}.log`);
    writeLog(`app.${daysAgo(1)}.log`);
    cleanOldLogs(testDir);
    const remaining = readdirSync(testDir);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toContain(daysAgo(1));
  });

  it('logs warning and continues when deletion fails with non-locked error', () => {
    const oldFile = `app.${daysAgo(5)}.log`;
    writeLog(oldFile);
    // Remove file then make it a directory so unlinkSync fails with EISDIR
    unlinkSync(join(testDir, oldFile));
    mkdirSync(join(testDir, oldFile));
    const result = cleanOldLogs(testDir);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('cleaned');
    rmdirSync(join(testDir, oldFile));
  });
});
