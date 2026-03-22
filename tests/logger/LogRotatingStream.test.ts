import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readdirSync, readFileSync, unlinkSync, rmdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import LogRotatingStream from '../../src/Logger/LogRotatingStream.js';

let testDir: string;
let openStreams: LogRotatingStream[] = [];

function clearDir(dir: string): void {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    try { unlinkSync(join(dir, f)); } catch { /* ignore */ }
  }
  try { rmdirSync(dir); } catch { /* ignore */ }
}

beforeEach(() => {
  testDir = join(tmpdir(), `rotating-test-${Date.now()}`);
  openStreams = [];
});

afterEach(async () => {
  await Promise.all(openStreams.map(s => new Promise<void>(res => s.end(res))));
  await new Promise(res => setTimeout(res, 50));
  clearDir(testDir);
});

function makeStream(): LogRotatingStream {
  const s = new LogRotatingStream(testDir);
  openStreams.push(s);
  return s;
}

function writeChunk(stream: LogRotatingStream, chunk: Buffer | string): Promise<void> {
  const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
  return new Promise((res, rej) =>
    stream.write(buf, (err) => { if (err) rej(err); else res(); })
  );
}

describe('LogRotatingStream', () => {
  it('creates log directory if it does not exist', () => {
    makeStream();
    expect(existsSync(testDir)).toBe(true);
  });

  it('writes data to app.DATE.log', async () => {
    const stream = makeStream();
    await writeChunk(stream, '{"msg":"hello"}\n');
    const files = readdirSync(testDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^app\.\d{4}-\d{2}-\d{2}\.log$/);
  });

  it('appends multiple writes to the same file', async () => {
    const stream = makeStream();
    await writeChunk(stream, 'line1\n');
    await writeChunk(stream, 'line2\n');
    const files = readdirSync(testDir);
    expect(files).toHaveLength(1);
    const content = readFileSync(join(testDir, files[0]), 'utf8');
    expect(content).toContain('line1');
    expect(content).toContain('line2');
  });

  it('creates overflow file when size exceeds 10 MB', async () => {
    const stream = makeStream();
    await writeChunk(stream, Buffer.alloc(6 * 1024 * 1024, 'a'));
    await writeChunk(stream, Buffer.alloc(6 * 1024 * 1024, 'b')); // triggers rotation
    const files = readdirSync(testDir);
    expect(files).toHaveLength(2);
    expect(files.some(f => /\.1\.log$/.test(f))).toBe(true); // overflow file exists
  });

  it('continues writing to new overflow file after rotation', async () => {
    const stream = makeStream();
    await writeChunk(stream, Buffer.alloc(6 * 1024 * 1024, 'a'));
    await writeChunk(stream, Buffer.alloc(6 * 1024 * 1024, 'b')); // rotation
    await writeChunk(stream, 'after-rotation\n');
    const overflowFile = readdirSync(testDir).find(f => /\.1\.log$/.test(f));
    expect(overflowFile).toBeDefined();
    const content = readFileSync(join(testDir, overflowFile!), 'utf8');
    expect(content).toContain('after-rotation');
  });

  it('creates new date file on day boundary', async () => {
    vi.useFakeTimers();
    try {
      const today = new Date('2026-03-01T10:00:00+02:00');
      vi.setSystemTime(today);
      const stream = makeStream();
      await writeChunk(stream, '{"msg":"today"}\n');

      // Advance to next day
      vi.setSystemTime(new Date('2026-03-02T10:00:00+02:00'));
      await writeChunk(stream, '{"msg":"tomorrow"}\n');

      const files = readdirSync(testDir);
      expect(files).toHaveLength(2);
      expect(files.some(f => f.includes('2026-03-01'))).toBe(true);
      expect(files.some(f => f.includes('2026-03-02'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
