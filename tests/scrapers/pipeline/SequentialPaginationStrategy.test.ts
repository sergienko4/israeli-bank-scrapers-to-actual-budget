import { describe, it, expect, vi } from 'vitest';
import createSequentialStrategy from '../../../src/Scrapers/Pipeline/Strategies/SequentialPaginationStrategy.js';
import { succeed, fail, isSuccess, isFail } from '../../../src/Types/ProcedureHelpers.js';
import type { IPipelineContext } from '../../../src/Scrapers/Pipeline/Types/PipelineContext.js';

function makeCtx(overrides: Partial<IPipelineContext> = {}): IPipelineContext {
  return {
    config: {} as IPipelineContext['config'],
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    shutdownHandler: { isShuttingDown: vi.fn().mockReturnValue(false), onShutdown: vi.fn() },
    services: {} as IPipelineContext['services'],
    state: { isDryRun: false, apiInitialized: false, banksProcessed: 0 },
    ...overrides,
  } as IPipelineContext;
}

describe('SequentialPaginationStrategy', () => {
  it('processes all items and returns their results', async () => {
    const strategy = createSequentialStrategy<string, number>({ pauseMs: 0 });
    const processor = vi.fn()
      .mockResolvedValueOnce(succeed(10))
      .mockResolvedValueOnce(succeed(20))
      .mockResolvedValueOnce(succeed(30));
    const ctx = makeCtx();

    const result = await strategy.paginate(['a', 'b', 'c'], processor, ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data).toEqual([10, 20, 30]);
      expect(result.status).toBe('all-processed');
    }
    expect(processor).toHaveBeenCalledTimes(3);
    expect(processor).toHaveBeenNthCalledWith(1, 'a');
    expect(processor).toHaveBeenNthCalledWith(2, 'b');
    expect(processor).toHaveBeenNthCalledWith(3, 'c');
  });

  it('failed item logs warning and continues to next', async () => {
    const strategy = createSequentialStrategy<string, number>({ pauseMs: 0 });
    const processor = vi.fn()
      .mockResolvedValueOnce(fail('item-a failed'))
      .mockResolvedValueOnce(succeed(20))
      .mockResolvedValueOnce(fail('item-c failed'));
    const ctx = makeCtx();

    const result = await strategy.paginate(['a', 'b', 'c'], processor, ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      // Only successful items appear in results
      expect(result.data).toEqual([20]);
    }
    expect(processor).toHaveBeenCalledTimes(3);
    expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Item 0 failed'));
    expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining('Item 2 failed'));
  });

  it('shutdown aborts early with failure', async () => {
    const ctx = makeCtx({
      shutdownHandler: {
        isShuttingDown: vi.fn().mockReturnValue(true),
        onShutdown: vi.fn(),
      } as unknown as IPipelineContext['shutdownHandler'],
    });
    const strategy = createSequentialStrategy<string, number>({ pauseMs: 0 });
    const processor = vi.fn();

    const result = await strategy.paginate(['a', 'b'], processor, ctx);

    expect(isFail(result)).toBe(true);
    if (isFail(result)) {
      expect(result.message).toContain('shutdown');
      expect(result.status).toBe('shutdown');
    }
    expect(processor).not.toHaveBeenCalled();
  });

  it('shutdown mid-processing aborts remaining items', async () => {
    const isShuttingDown = vi.fn()
      .mockReturnValueOnce(false) // first item proceeds
      .mockReturnValueOnce(true); // second item aborted
    const ctx = makeCtx({
      shutdownHandler: {
        isShuttingDown,
        onShutdown: vi.fn(),
      } as unknown as IPipelineContext['shutdownHandler'],
    });
    const strategy = createSequentialStrategy<string, number>({ pauseMs: 0 });
    const processor = vi.fn().mockResolvedValue(succeed(10));

    const result = await strategy.paginate(['a', 'b', 'c'], processor, ctx);

    expect(isFail(result)).toBe(true);
    if (isFail(result)) {
      expect(result.status).toBe('shutdown');
    }
    expect(processor).toHaveBeenCalledTimes(1);
  });

  it('pauses between items when pauseMs > 0', async () => {
    vi.useFakeTimers();
    const strategy = createSequentialStrategy<string, number>({ pauseMs: 100 });
    const processor = vi.fn().mockResolvedValue(succeed(1));
    const ctx = makeCtx();

    const promise = strategy.paginate(['a', 'b'], processor, ctx);

    // First item processes immediately (no pause before index 0)
    await vi.advanceTimersByTimeAsync(0);
    // Advance past the pause for item at index 1
    await vi.advanceTimersByTimeAsync(100);

    const result = await promise;

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data).toEqual([1, 1]);
    }
    expect(processor).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('empty array returns empty result', async () => {
    const strategy = createSequentialStrategy<string, number>({ pauseMs: 0 });
    const processor = vi.fn();
    const ctx = makeCtx();

    const result = await strategy.paginate([], processor, ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data).toEqual([]);
      expect(result.status).toBe('all-processed');
    }
    expect(processor).not.toHaveBeenCalled();
  });

  it('result data is a new array (immutability)', async () => {
    const strategy = createSequentialStrategy<string, number>({ pauseMs: 0 });
    const processor = vi.fn().mockResolvedValue(succeed(42));
    const ctx = makeCtx();

    const result1 = await strategy.paginate(['a'], processor, ctx);
    const result2 = await strategy.paginate(['a'], processor, ctx);

    expect(isSuccess(result1)).toBe(true);
    expect(isSuccess(result2)).toBe(true);
    if (isSuccess(result1) && isSuccess(result2)) {
      expect(result1.data).not.toBe(result2.data);
    }
  });

  it('shutdown after pause aborts with failure', async () => {
    vi.useFakeTimers();
    const isShuttingDown = vi.fn()
      .mockReturnValueOnce(false)  // processAt check for item 0
      .mockReturnValueOnce(false)  // processAt check for item 1 (before pause)
      .mockReturnValueOnce(true);  // pauseIfNeeded check after pause completes
    const ctx = makeCtx({
      shutdownHandler: {
        isShuttingDown,
        onShutdown: vi.fn(),
      } as unknown as IPipelineContext['shutdownHandler'],
    });
    const strategy = createSequentialStrategy<string, number>({ pauseMs: 50 });
    const processor = vi.fn().mockResolvedValue(succeed(10));

    const promise = strategy.paginate(['a', 'b'], processor, ctx);

    // First item processes (no pause for index 0)
    await vi.advanceTimersByTimeAsync(0);
    // Advance past the pause for index 1 -- triggers post-pause shutdown check
    await vi.advanceTimersByTimeAsync(50);

    const result = await promise;

    expect(isFail(result)).toBe(true);
    if (isFail(result)) {
      expect(result.message).toContain('shutdown requested after pause');
      expect(result.status).toBe('shutdown');
    }
    // Only the first item should have been processed
    expect(processor).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
