import { describe, it, expect, vi, afterEach } from 'vitest';
import { ExponentialBackoffRetry } from '../../src/resilience/RetryStrategy.js';
import { ShutdownError } from '../../src/errors/ErrorTypes.js';

describe('ExponentialBackoffRetry', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('succeeds on first attempt', async () => {
    const retry = new ExponentialBackoffRetry({
      maxAttempts: 3,
      initialBackoffMs: 1000
    });

    const fn = vi.fn().mockResolvedValue('success');
    const result = await retry.execute(fn, 'test');

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and eventually succeeds', async () => {
    vi.useFakeTimers();

    const retry = new ExponentialBackoffRetry({
      maxAttempts: 3,
      initialBackoffMs: 1000
    });

    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('Fail 1'))
      .mockResolvedValue('success');

    const promise = retry.execute(fn, 'test');

    // First attempt fails, backoff 1000ms
    await vi.advanceTimersByTimeAsync(1001);

    const result = await promise;
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after max attempts exhausted', async () => {
    vi.useFakeTimers();

    const retry = new ExponentialBackoffRetry({
      maxAttempts: 2,
      initialBackoffMs: 100
    });

    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('Fail 1'))
      .mockRejectedValueOnce(new Error('Fail 2'));

    const promise = retry.execute(fn, 'test-op');
    // Attach handler immediately to prevent unhandled rejection
    const resultPromise = promise.catch((e: Error) => e);

    // Advance past backoff for first retry
    await vi.advanceTimersByTimeAsync(101);

    const error = await resultPromise;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('test-op failed after 2 attempts');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws ShutdownError when shouldShutdown returns true', async () => {
    const retry = new ExponentialBackoffRetry({
      maxAttempts: 3,
      initialBackoffMs: 1000,
      shouldShutdown: () => true
    });

    const fn = vi.fn().mockResolvedValue('success');

    await expect(retry.execute(fn, 'test')).rejects.toThrow(ShutdownError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('calls onRetry callback on failure', async () => {
    vi.useFakeTimers();

    const onRetry = vi.fn();
    const retry = new ExponentialBackoffRetry({
      maxAttempts: 3,
      initialBackoffMs: 1000,
      onRetry
    });

    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('Fail'))
      .mockResolvedValue('success');

    const promise = retry.execute(fn, 'test');

    await vi.advanceTimersByTimeAsync(1001);
    await promise;

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, 3, 1000, expect.any(Error));
  });

  it('uses exponential backoff timing', async () => {
    vi.useFakeTimers();

    const onRetry = vi.fn();
    const retry = new ExponentialBackoffRetry({
      maxAttempts: 4,
      initialBackoffMs: 1000,
      onRetry
    });

    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('Fail 1'))
      .mockRejectedValueOnce(new Error('Fail 2'))
      .mockRejectedValueOnce(new Error('Fail 3'))
      .mockResolvedValue('success');

    const promise = retry.execute(fn, 'test');

    // First backoff: 1000ms (1000 * 2^0)
    await vi.advanceTimersByTimeAsync(1001);
    // Second backoff: 2000ms (1000 * 2^1)
    await vi.advanceTimersByTimeAsync(2001);
    // Third backoff: 4000ms (1000 * 2^2)
    await vi.advanceTimersByTimeAsync(4001);

    await promise;

    expect(onRetry).toHaveBeenCalledWith(1, 4, 1000, expect.any(Error));
    expect(onRetry).toHaveBeenCalledWith(2, 4, 2000, expect.any(Error));
    expect(onRetry).toHaveBeenCalledWith(3, 4, 4000, expect.any(Error));
  });
});
