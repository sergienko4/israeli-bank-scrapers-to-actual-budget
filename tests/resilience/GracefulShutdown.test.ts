import { describe, it, expect, vi, afterEach } from 'vitest';
import { GracefulShutdownHandler } from '../../src/resilience/GracefulShutdown.js';

describe('GracefulShutdownHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Remove signal listeners added by the constructor
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
  });

  it('isShuttingDown returns false initially', () => {
    const handler = new GracefulShutdownHandler();
    expect(handler.isShuttingDown()).toBe(false);
  });

  it('registers shutdown callbacks without error', () => {
    const handler = new GracefulShutdownHandler();
    const callback = vi.fn();
    expect(() => handler.onShutdown(callback)).not.toThrow();
  });

  it('can register multiple callbacks', () => {
    const handler = new GracefulShutdownHandler();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    handler.onShutdown(cb1);
    handler.onShutdown(cb2);
    // No error means success - callbacks stored internally
    expect(handler.isShuttingDown()).toBe(false);
  });
});
