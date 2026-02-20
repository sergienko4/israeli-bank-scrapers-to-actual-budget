import { describe, it, expect, beforeEach } from 'vitest';
import { createLogger, getLogger, getLogBuffer } from '../../src/logger/index.js';
import { ConsoleLogger } from '../../src/logger/ConsoleLogger.js';
import { JsonLogger } from '../../src/logger/JsonLogger.js';
import { TableLogger } from '../../src/logger/TableLogger.js';
import { PhoneLogger } from '../../src/logger/PhoneLogger.js';

describe('logger factory', () => {
  beforeEach(() => {
    // Reset singleton by creating a new default logger
    createLogger();
  });

  it('defaults to ConsoleLogger', () => {
    const logger = createLogger();
    expect(logger).toBeInstanceOf(ConsoleLogger);
  });

  it('creates JsonLogger for json format', () => {
    const logger = createLogger({ format: 'json' });
    expect(logger).toBeInstanceOf(JsonLogger);
  });

  it('creates TableLogger for table format', () => {
    const logger = createLogger({ format: 'table' });
    expect(logger).toBeInstanceOf(TableLogger);
  });

  it('creates PhoneLogger for phone format', () => {
    const logger = createLogger({ format: 'phone' });
    expect(logger).toBeInstanceOf(PhoneLogger);
  });

  it('getLogger returns singleton', () => {
    const created = createLogger({ format: 'json' });
    expect(getLogger()).toBe(created);
  });

  it('getLogger creates default if not initialized', () => {
    // Force reset by creating then getting
    createLogger();
    const logger = getLogger();
    expect(logger).toBeInstanceOf(ConsoleLogger);
  });

  it('getLogBuffer returns the buffer', () => {
    createLogger({ maxBufferSize: 10 });
    const buffer = getLogBuffer();
    expect(buffer).toBeDefined();
    expect(buffer.isEnabled()).toBe(true);
  });

  it('buffer disabled by default (zero memory)', () => {
    createLogger();
    const buffer = getLogBuffer();
    expect(buffer.isEnabled()).toBe(false);
  });

  it('passes maxBufferSize to buffer', () => {
    createLogger({ maxBufferSize: 3 });
    const logger = getLogger();
    const buffer = getLogBuffer();
    logger.info('a');
    logger.info('b');
    logger.info('c');
    logger.info('d');
    expect(buffer.size()).toBe(3);
  });
});
