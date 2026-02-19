import { describe, it, expect, vi, afterEach } from 'vitest';
import { TimeoutWrapper } from '../../src/resilience/TimeoutWrapper.js';
import { TimeoutError } from '../../src/errors/ErrorTypes.js';

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
});
