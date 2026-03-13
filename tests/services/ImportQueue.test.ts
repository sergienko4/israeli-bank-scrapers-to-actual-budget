import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImportQueue } from '../../src/Services/ImportQueue.js';

vi.mock('../../src/Logger/Index.js', () => ({
  getLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  createLogger: vi.fn(),
  deriveLogFormat: vi.fn().mockReturnValue('words'),
}));

describe('ImportQueue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('processes a single enqueued job', async () => {
    const process = vi.fn().mockResolvedValue('done');
    const onJobComplete = vi.fn();
    const onQueueEmpty = vi.fn();
    const queue = new ImportQueue({ process, onJobComplete, onQueueEmpty });

    queue.enqueue('job1');
    // Wait for drain
    await vi.waitFor(() => expect(onQueueEmpty).toHaveBeenCalled());

    expect(process).toHaveBeenCalledWith('job1');
    expect(onJobComplete).toHaveBeenCalledWith('job1', 'done');
  });

  it('processes multiple jobs sequentially via enqueueAll', async () => {
    const order: string[] = [];
    /** @param job - Job name to process. @returns Resolved promise. */
    const process = vi.fn().mockImplementation(async (job: string) => {
      order.push(job);
      return job;
    });
    const onQueueEmpty = vi.fn();
    const queue = new ImportQueue({ process, onQueueEmpty });

    queue.enqueueAll(['a', 'b', 'c']);
    await vi.waitFor(() => expect(onQueueEmpty).toHaveBeenCalled());

    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('enqueueAll with empty array does nothing', () => {
    const process = vi.fn();
    const queue = new ImportQueue({ process });

    queue.enqueueAll([]);

    expect(process).not.toHaveBeenCalled();
    expect(queue.size()).toBe(0);
    expect(queue.isBusy()).toBe(false);
  });

  it('reports size, isProcessing, and isBusy correctly', async () => {
    let resolveJob: (() => void) | undefined;
    const process = vi.fn().mockImplementation(
      () => new Promise<void>((r) => { resolveJob = r; })
    );
    const queue = new ImportQueue({ process });

    expect(queue.size()).toBe(0);
    expect(queue.isProcessing()).toBe(false);
    expect(queue.isBusy()).toBe(false);

    queue.enqueue('x');
    queue.enqueue('y');

    // First job is processing, second is waiting
    await vi.waitFor(() => expect(process).toHaveBeenCalledTimes(1));
    expect(queue.isProcessing()).toBe(true);
    expect(queue.size()).toBe(1); // 'y' waiting
    expect(queue.isBusy()).toBe(true);

    resolveJob?.();
  });

  it('handles process errors gracefully and continues', async () => {
    const process = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('ok');
    const onJobComplete = vi.fn();
    const onQueueEmpty = vi.fn();
    const queue = new ImportQueue({ process, onJobComplete, onQueueEmpty });

    queue.enqueueAll(['bad', 'good']);
    await vi.waitFor(() => expect(onQueueEmpty).toHaveBeenCalled());

    expect(onJobComplete).toHaveBeenCalledTimes(2);
    // First call: error passed as result
    expect(onJobComplete.mock.calls[0][0]).toBe('bad');
    expect(onJobComplete.mock.calls[0][1]).toBeInstanceOf(Error);
    // Second call: success
    expect(onJobComplete.mock.calls[1][0]).toBe('good');
    expect(onJobComplete.mock.calls[1][1]).toBe('ok');
  });

  it('does not start drain twice if enqueue called while processing', async () => {
    let resolveFirst: (() => void) | undefined;
    const process = vi.fn()
      .mockImplementationOnce(
        () => new Promise<void>((r) => { resolveFirst = r; })
      )
      .mockResolvedValue('done');
    const onQueueEmpty = vi.fn();
    const queue = new ImportQueue({ process, onQueueEmpty });

    queue.enqueue('first');
    await vi.waitFor(() => expect(process).toHaveBeenCalledTimes(1));

    // Enqueue while first is processing — should not start a second drain
    queue.enqueue('second');
    expect(queue.size()).toBe(1);

    resolveFirst?.();
    await vi.waitFor(() => expect(onQueueEmpty).toHaveBeenCalled());

    expect(process).toHaveBeenCalledTimes(2);
  });

  it('works without optional callbacks', async () => {
    const process = vi.fn().mockResolvedValue('ok');
    const queue = new ImportQueue({ process });

    queue.enqueue('solo');
    await vi.waitFor(() => expect(process).toHaveBeenCalled());
    // No onJobComplete or onQueueEmpty — should not throw
  });
});
