import { describe, it, expect, beforeEach } from 'vitest';
import {
  createLogger, getLogger, getLogBuffer, deriveLogFormat
} from '../../src/Logger/index.js';
import { PinoAdapter } from '../../src/Logger/PinoAdapter.js';
import { LogMediator } from '../../src/Logger/LogMediator.js';

describe('logger factory', () => {
  beforeEach(() => {
    createLogger();
  });

  it('defaults to PinoAdapter (words format, no file)', () => {
    expect(createLogger()).toBeInstanceOf(PinoAdapter);
  });

  it('creates PinoAdapter for all formats (no logDir)', () => {
    expect(createLogger({ format: 'json' })).toBeInstanceOf(PinoAdapter);
    expect(createLogger({ format: 'table' })).toBeInstanceOf(PinoAdapter);
    expect(createLogger({ format: 'phone' })).toBeInstanceOf(PinoAdapter);
  });

  it('creates LogMediator when logDir is set', () => {
    expect(createLogger({ logDir: '/tmp/test-logs-xyz' })).toBeInstanceOf(LogMediator);
  });

  it('getLogger returns singleton', () => {
    const created = createLogger({ format: 'json' });
    expect(getLogger()).toBe(created);
  });

  it('getLogger creates default if not initialized', () => {
    createLogger();
    expect(getLogger()).toBeInstanceOf(PinoAdapter);
  });

  it('getLogBuffer returns a LogBuffer instance', () => {
    createLogger();
    expect(getLogBuffer()).toBeDefined();
  });

  it('buffer is always disabled (no longer functional)', () => {
    createLogger();
    expect(getLogBuffer().isEnabled()).toBe(false);
  });

  it('falls back to PinoAdapter for unknown format', () => {
    expect(createLogger({ format: 'invalid' as never })).toBeInstanceOf(PinoAdapter);
  });

  it('LogMediator routes method calls to all targets', () => {
    const logger = createLogger({ logDir: '/tmp/test-mediator-xyz' });
    expect(logger).toBeInstanceOf(LogMediator);
    // Should not throw — verifies all targets receive the call
    expect(() => logger.info('test')).not.toThrow();
    expect(() => logger.debug('test')).not.toThrow();
    expect(() => logger.warn('test')).not.toThrow();
    expect(() => logger.error('test')).not.toThrow();
  });
});

describe('deriveLogFormat', () => {
  it('returns phone when listenForCommands is true (highest priority)', () => {
    expect(deriveLogFormat('compact', true)).toBe('phone');
    expect(deriveLogFormat('ledger', true)).toBe('phone');
    expect(deriveLogFormat(undefined, true)).toBe('phone');
  });

  it('maps summary → words', () => {
    expect(deriveLogFormat('summary', false)).toBe('words');
  });

  it('maps compact → table', () => {
    expect(deriveLogFormat('compact', false)).toBe('table');
  });

  it('maps ledger → json', () => {
    expect(deriveLogFormat('ledger', false)).toBe('json');
  });

  it('maps emoji → words', () => {
    expect(deriveLogFormat('emoji', false)).toBe('words');
  });

  it('defaults to words when no Telegram config', () => {
    expect(deriveLogFormat(undefined, false)).toBe('words');
    expect(deriveLogFormat(undefined, undefined)).toBe('words');
  });
});
