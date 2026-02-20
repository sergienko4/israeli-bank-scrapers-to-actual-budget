import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JsonLogger, JsonLogEntry } from '../../src/logger/JsonLogger.js';
import { LogBuffer } from '../../src/logger/LogBuffer.js';

describe('JsonLogger', () => {
  let logger: JsonLogger;
  let buffer: LogBuffer;

  beforeEach(() => {
    buffer = new LogBuffer(50);
    logger = new JsonLogger(buffer);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function parseLastLog(): JsonLogEntry {
    const call = (console.log as ReturnType<typeof vi.fn>).mock.calls.at(-1)
      ?? (console.error as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    return JSON.parse(call![0] as string) as JsonLogEntry;
  }

  it('outputs valid JSON', () => {
    logger.info('test');
    const raw = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('includes timestamp in ISO format', () => {
    logger.info('test');
    const entry = parseLastLog();
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('includes correct level', () => {
    logger.warn('test');
    const entry = parseLastLog();
    expect(entry.level).toBe('warn');
  });

  it('includes message', () => {
    logger.info('hello');
    expect(parseLastLog().message).toBe('hello');
  });

  it('spreads context into entry', () => {
    logger.info('importing', { bank: 'discount', count: 5 });
    const entry = parseLastLog();
    expect(entry.bank).toBe('discount');
    expect(entry.count).toBe(5);
  });

  it('sends errors to console.error', () => {
    logger.error('fail');
    expect(console.error).toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it('sends info to console.log', () => {
    logger.info('ok');
    expect(console.log).toHaveBeenCalled();
  });

  it('sends warn to console.log (not stderr)', () => {
    logger.warn('caution');
    expect(console.log).toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('adds entries to ring buffer', () => {
    logger.info('line 1');
    expect(buffer.size()).toBe(1);
    const parsed = JSON.parse(buffer.getRecent()[0]) as JsonLogEntry;
    expect(parsed.message).toBe('line 1');
  });

  it('core fields override context conflicts', () => {
    logger.info('test', { timestamp: 'fake', level: 'fake', message: 'fake' });
    const entry = parseLastLog();
    expect(entry.message).toBe('test');
    expect(entry.level).toBe('info');
    expect(entry.timestamp).not.toBe('fake');
  });
});
