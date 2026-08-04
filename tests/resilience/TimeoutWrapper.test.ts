import { describe, it, expect, vi, afterEach } from 'vitest';
import { TimeoutWrapper } from '../../src/Resilience/TimeoutWrapper.js';
import { TimeoutError } from '../../src/Errors/ErrorTypes.js';

describe('TimeoutWrapper', () => {
  const wrapper = new TimeoutWrapper();

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns value when promise resolves before timeout', async () => {
    const result = await wrapper.wrap(
      Promise.resolve('success'),
      5000,
      'test-op'
    );
    expect(result).toBe('success');
  });

  it('throws TimeoutError when operation exceeds timeout', async () => {
    vi.useFakeTimers();

    const slowPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve('late'), 10000);
    });

    const resultPromise = wrapper.wrap(slowPromise, 5000, 'test-op');

    vi.advanceTimersByTime(5001);

    await expect(resultPromise).rejects.toThrow(TimeoutError);
  });

  it('includes operation name in TimeoutError', async () => {
    vi.useFakeTimers();

    const slowPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve('late'), 10000);
    });

    const resultPromise = wrapper.wrap(slowPromise, 3000, 'Scraping discount');

    vi.advanceTimersByTime(3001);

    await expect(resultPromise).rejects.toThrow('Scraping discount');
  });

  it('resolves with value when fast enough', async () => {
    const fastPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve('fast result'), 10);
    });
    const result = await wrapper.wrap(fastPromise, 5000, 'test-op');
    expect(result).toBe('fast result');
  });

  it('does not emit an unhandled rejection when the operation rejects', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      await expect(wrapper.wrap(Promise.reject(new Error('boom')), 5000, 'op'))
        .rejects.toThrow('boom');
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
