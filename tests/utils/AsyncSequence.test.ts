import { describe, it, expect } from 'vitest';
import { mapInOrder, repeatWhile } from '../../src/Utils/Index.js';

/**
 * Resolves after the current macrotask, giving any eagerly started
 * work the chance to run before the test inspects its log.
 * @returns A promise that settles on the next event-loop turn.
 */
function nextTurn(): Promise<void> {
  return new Promise<void>(resolve => { setImmediate(resolve); });
}

describe('mapInOrder', () => {
  it('yields each step result in item order', async () => {
    const accounts = ['leumi', 'discount', 'max'];
    const results: string[] = [];

    for await (const result of mapInOrder(accounts, name => Promise.resolve(`${name}:ok`))) {
      results.push(result);
    }

    expect(results).toEqual(['leumi:ok', 'discount:ok', 'max:ok']);
  });

  it('starts the next step only after the consumer body has run', async () => {
    const log: string[] = [];
    const step = async (id: number): Promise<number> => {
      log.push(`start ${String(id)}`);
      await nextTurn();
      log.push(`end ${String(id)}`);
      return id;
    };

    for await (const id of mapInOrder([1, 2], step)) {
      await nextTurn();
      log.push(`body ${String(id)}`);
    }

    expect(log).toEqual(['start 1', 'end 1', 'body 1', 'start 2', 'end 2', 'body 2']);
  });

  it('visits items appended to the array during iteration', async () => {
    const jobs = ['first'];
    const seen: string[] = [];

    for await (const job of mapInOrder(jobs, name => Promise.resolve(name))) {
      seen.push(job);
      if (job === 'first') jobs.push('appended');
    }

    expect(seen).toEqual(['first', 'appended']);
  });

  it('rethrows a rejected step and runs no later step', async () => {
    const started: string[] = [];
    const step = (name: string): Promise<string> => {
      started.push(name);
      if (name === 'bad') return Promise.reject(new Error('step bad failed'));
      return Promise.resolve(name);
    };

    const consume = async (): Promise<string[]> => {
      const done: string[] = [];
      for await (const name of mapInOrder(['ok', 'bad', 'never'], step)) done.push(name);
      return done;
    };

    await expect(consume()).rejects.toThrow('step bad failed');
    expect(started).toEqual(['ok', 'bad']);
  });

  it('runs no further step after the consumer breaks', async () => {
    const started: number[] = [];
    const step = (id: number): Promise<number> => {
      started.push(id);
      return Promise.resolve(id);
    };

    for await (const id of mapInOrder([1, 2, 3], step)) {
      if (id === 1) break;
    }

    expect(started).toEqual([1]);
  });

  it('never calls the step for an empty array', async () => {
    let calls = 0;
    const results: number[] = [];

    for await (const value of mapInOrder<number, number>([], item => {
      calls += 1;
      return Promise.resolve(item);
    })) {
      results.push(value);
    }

    expect({ calls, results }).toEqual({ calls: 0, results: [] });
  });
});

describe('repeatWhile', () => {
  it('yields step results while the condition holds', async () => {
    let attempt = 0;
    const results: number[] = [];

    for await (const value of repeatWhile(() => attempt < 3, () => {
      attempt += 1;
      return Promise.resolve(attempt * 10);
    })) {
      results.push(value);
    }

    expect(results).toEqual([10, 20, 30]);
  });

  it('re-checks the condition after the consumer body runs', async () => {
    const queue = ['job-a', 'job-b', 'job-c'];
    const processed: string[] = [];

    for await (const job of repeatWhile(() => queue.length > 0, () => {
      const next = queue.shift() ?? '';
      return Promise.resolve(next);
    })) {
      processed.push(job);
      if (job === 'job-a') queue.length = 0;
    }

    expect(processed).toEqual(['job-a']);
  });

  it('starts the next step only after the consumer body has run', async () => {
    const log: string[] = [];
    let round = 0;
    const step = async (): Promise<number> => {
      round += 1;
      const current = round;
      log.push(`start ${String(current)}`);
      await nextTurn();
      return current;
    };

    for await (const current of repeatWhile(() => round < 2, step)) {
      await nextTurn();
      log.push(`body ${String(current)}`);
    }

    expect(log).toEqual(['start 1', 'body 1', 'start 2', 'body 2']);
  });

  it('never calls the step when the condition is false from the start', async () => {
    let calls = 0;
    const results: number[] = [];

    for await (const value of repeatWhile(() => false, () => {
      calls += 1;
      return Promise.resolve(calls);
    })) {
      results.push(value);
    }

    expect({ calls, results }).toEqual({ calls: 0, results: [] });
  });

  it('rethrows a rejected step and stops repeating', async () => {
    let calls = 0;
    const step = (): Promise<number> => {
      calls += 1;
      if (calls === 2) return Promise.reject(new Error('poll 2 failed'));
      return Promise.resolve(calls);
    };

    const consume = async (): Promise<number[]> => {
      const done: number[] = [];
      for await (const value of repeatWhile(() => true, step)) done.push(value);
      return done;
    };

    await expect(consume()).rejects.toThrow('poll 2 failed');
    expect(calls).toBe(2);
  });

  it('runs no further step after the consumer breaks', async () => {
    let calls = 0;

    for await (const value of repeatWhile(() => true, () => {
      calls += 1;
      return Promise.resolve(calls);
    })) {
      if (value === 1) break;
    }

    expect(calls).toBe(1);
  });
});
