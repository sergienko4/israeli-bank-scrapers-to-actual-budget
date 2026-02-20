import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GracefulShutdownHandler } from '../../src/resilience/GracefulShutdown.js';

describe('GracefulShutdownHandler', () => {
  let exitSpy: any;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    handler.onShutdown(vi.fn());
    handler.onShutdown(vi.fn());
    expect(handler.isShuttingDown()).toBe(false);
  });

  it('sets shuttingDown to true on SIGTERM', async () => {
    const handler = new GracefulShutdownHandler();

    process.emit('SIGTERM');
    // Allow async handleShutdown to run
    await vi.waitFor(() => expect(handler.isShuttingDown()).toBe(true));
  });

  it('sets shuttingDown to true on SIGINT', async () => {
    const handler = new GracefulShutdownHandler();

    process.emit('SIGINT');
    await vi.waitFor(() => expect(handler.isShuttingDown()).toBe(true));
  });

  it('executes registered callbacks on shutdown', async () => {
    const handler = new GracefulShutdownHandler();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    handler.onShutdown(cb1);
    handler.onShutdown(cb2);

    process.emit('SIGTERM');
    await vi.waitFor(() => expect(cb1).toHaveBeenCalledTimes(1));
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it('executes async callbacks on shutdown', async () => {
    const handler = new GracefulShutdownHandler();
    const asyncCb = vi.fn().mockResolvedValue(undefined);
    handler.onShutdown(asyncCb);

    process.emit('SIGTERM');
    await vi.waitFor(() => expect(asyncCb).toHaveBeenCalledTimes(1));
  });

  it('catches errors from callbacks without stopping', async () => {
    const handler = new GracefulShutdownHandler();
    const failingCb = vi.fn().mockRejectedValue(new Error('callback error'));
    const succeedingCb = vi.fn();
    handler.onShutdown(failingCb);
    handler.onShutdown(succeedingCb);

    process.emit('SIGTERM');
    await vi.waitFor(() => expect(succeedingCb).toHaveBeenCalledTimes(1));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Error during shutdown callback: callback error'));
  });

  it('calls process.exit(0) after shutdown completes', async () => {
    const handler = new GracefulShutdownHandler();

    process.emit('SIGTERM');
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0));
  });

  it('ignores duplicate shutdown signals', async () => {
    const handler = new GracefulShutdownHandler();
    const cb = vi.fn();
    handler.onShutdown(cb);

    process.emit('SIGTERM');
    await vi.waitFor(() => expect(cb).toHaveBeenCalledTimes(1));

    // Second signal should be ignored
    process.emit('SIGTERM');
    // Small delay to ensure second signal is processed
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('logs signal name on shutdown', async () => {
    const handler = new GracefulShutdownHandler();

    process.emit('SIGTERM');
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('SIGTERM')
    ));
  });
});
