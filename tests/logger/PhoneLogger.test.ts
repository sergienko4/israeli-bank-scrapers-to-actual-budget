import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PhoneLogger } from '../../src/logger/PhoneLogger.js';
import { LogBuffer } from '../../src/logger/LogBuffer.js';

describe('PhoneLogger', () => {
  let logger: PhoneLogger;
  let buffer: LogBuffer;

  beforeEach(() => {
    buffer = new LogBuffer(50);
    logger = new PhoneLogger(buffer);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefixes info with >', () => {
    logger.info('test message');
    const line = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(line).toBe('> test message');
  });

  it('prefixes error with !', () => {
    logger.error('fail');
    const line = (console.error as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(line).toBe('! fail');
  });

  it('strips emojis from messages', () => {
    logger.info('🚀 Starting import');
    const line = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(line).toBe('> Starting import');
  });

  it('collapses extra whitespace after emoji removal', () => {
    logger.info('✅  Success  🎉');
    const line = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(line).toBe('> Success');
  });

  it('sends errors to console.error', () => {
    logger.error('bad');
    expect(console.error).toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
  });

  it('adds compact entries to ring buffer', () => {
    logger.info('buffered');
    expect(buffer.getRecent()[0]).toBe('> buffered');
  });

  it('prefixes debug with >', () => {
    logger.debug('detail');
    const line = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(line).toBe('> detail');
  });

  it('prefixes warn with >', () => {
    logger.warn('caution');
    const line = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(line).toBe('> caution');
  });
});
