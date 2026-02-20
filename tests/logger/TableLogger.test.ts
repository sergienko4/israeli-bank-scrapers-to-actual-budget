import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TableLogger } from '../../src/logger/TableLogger.js';
import { LogBuffer } from '../../src/logger/LogBuffer.js';

describe('TableLogger', () => {
  let logger: TableLogger;
  let buffer: LogBuffer;

  beforeEach(() => {
    buffer = new LogBuffer(50);
    logger = new TableLogger(buffer);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('formats info with timestamp and INFO label', () => {
    logger.info('test message');
    const line = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(line).toMatch(/^\[\d{2}:\d{2}:\d{2}\] INFO  test message$/);
  });

  it('formats error with ERROR label', () => {
    logger.error('fail');
    const line = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(line).toMatch(/^\[\d{2}:\d{2}:\d{2}\] ERROR fail$/);
  });

  it('formats warn with WARN label', () => {
    logger.warn('caution');
    const line = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(line).toMatch(/WARN  caution$/);
  });

  it('formats debug with DEBUG label', () => {
    logger.debug('detail');
    const line = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(line).toMatch(/DEBUG detail$/);
  });

  it('sends errors to console.error', () => {
    logger.error('bad');
    expect(console.error).toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it('adds formatted entries to ring buffer', () => {
    logger.info('buffered');
    expect(buffer.getRecent()[0]).toMatch(/INFO  buffered$/);
  });
});
