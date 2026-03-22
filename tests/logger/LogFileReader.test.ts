import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readdirSync, unlinkSync, rmdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import LogFileReader from '../../src/Logger/LogFileReader.js';

let testDir: string;

function cleanup(dir: string): void {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) unlinkSync(join(dir, f));
  rmdirSync(dir);
}

beforeEach(() => {
  testDir = join(tmpdir(), `logreader-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => cleanup(testDir));

function pinoLine(msg: string, levelNum = 30): string {
  return JSON.stringify({ time: Date.now(), level: levelNum, msg, pid: 1, hostname: 'h' });
}

function writeLog(name: string, lines: string[]): void {
  writeFileSync(join(testDir, name), lines.join('\n') + '\n');
}

describe('LogFileReader', () => {
  it('returns empty array when directory does not exist', () => {
    const reader = new LogFileReader('/tmp/nonexistent-xyz-dir');
    expect(reader.getRecent(10)).toEqual([]);
  });

  it('returns empty array when no log files present', () => {
    const reader = new LogFileReader(testDir);
    expect(reader.getRecent(10)).toEqual([]);
  });

  it('formats lines as [HH:MM:SS] LEVEL  message', () => {
    writeLog('app.2026-03-01.log', [pinoLine('hello world')]);
    const reader = new LogFileReader(testDir);
    const entries = reader.getRecent(10);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^\[\d{2}:\d{2}:\d{2}\] INFO  hello world$/);
  });

  it('maps pino level numbers to labels correctly', () => {
    writeLog('app.2026-03-01.log', [
      pinoLine('debug msg', 20),
      pinoLine('warn msg', 40),
      pinoLine('error msg', 50),
    ]);
    const entries = new LogFileReader(testDir).getRecent(10);
    expect(entries[0]).toContain('DEBUG');
    expect(entries[1]).toContain('WARN ');
    expect(entries[2]).toContain('ERROR');
  });

  it('skips malformed (non-JSON) lines silently', () => {
    writeLog('app.2026-03-01.log', ['not json at all', pinoLine('valid')]);
    const entries = new LogFileReader(testDir).getRecent(10);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain('valid');
  });

  it('returns at most count entries', () => {
    const lines = Array.from({ length: 20 }, (_, i) => pinoLine(`line ${i}`));
    writeLog('app.2026-03-01.log', lines);
    expect(new LogFileReader(testDir).getRecent(5)).toHaveLength(5);
  });

  it('reads newest file first', () => {
    writeLog('app.2026-03-01.log', [pinoLine('old')]);
    writeLog('app.2026-03-02.log', [pinoLine('new')]);
    const entries = new LogFileReader(testDir).getRecent(1);
    expect(entries[0]).toContain('new');
  });

  it('spans multiple files when count exceeds single file', () => {
    writeLog('app.2026-03-01.log', [pinoLine('day1')]);
    writeLog('app.2026-03-02.log', [pinoLine('day2')]);
    const entries = new LogFileReader(testDir).getRecent(10);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toContain('day1');
    expect(entries[1]).toContain('day2');
  });

  it('formats unknown level numbers with INFO fallback', () => {
    writeLog('app.2026-03-01.log', [
      pinoLine('fatal message', 60),  // pino fatal level
      pinoLine('trace message', 10),  // pino trace level
    ]);
    const entries = new LogFileReader(testDir).getRecent(10);
    expect(entries[0]).toContain('INFO '); // fallback label
    expect(entries[1]).toContain('INFO '); // fallback label
    expect(entries[0]).toContain('fatal message');
    expect(entries[1]).toContain('trace message');
  });
});
