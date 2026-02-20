import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConsoleLogger } from '../../src/logger/ConsoleLogger.js';
import { LogBuffer } from '../../src/logger/LogBuffer.js';

describe('ConsoleLogger', () => {
  let logger: ConsoleLogger;
  let buffer: LogBuffer;

  beforeEach(() => {
    buffer = new LogBuffer(50);
    logger = new ConsoleLogger(buffer);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('info calls console.log', () => {
    logger.info('hello world');
    expect(console.log).toHaveBeenCalledWith('hello world');
  });

  it('warn calls console.warn', () => {
    logger.warn('warning msg');
    expect(console.warn).toHaveBeenCalledWith('warning msg');
  });

  it('error calls console.error', () => {
    logger.error('error msg');
    expect(console.error).toHaveBeenCalledWith('error msg');
  });

  it('debug calls console.debug', () => {
    logger.debug('debug msg');
    expect(console.debug).toHaveBeenCalledWith('debug msg');
  });

  it('preserves emoji in messages', () => {
    logger.info('🚀 Starting import');
    expect(console.log).toHaveBeenCalledWith('🚀 Starting import');
  });

  it('adds entries to ring buffer', () => {
    logger.info('line 1');
    logger.error('line 2');
    expect(buffer.getRecent()).toEqual(['line 1', 'line 2']);
  });
});
