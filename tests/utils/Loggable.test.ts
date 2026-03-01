import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as LoggerModule from '../../src/Logger/index.js';
import { Loggable } from '../../src/Utils/Loggable.js';

const mockLogger = {
  info:  vi.fn(),
  debug: vi.fn(),
  warn:  vi.fn(),
  error: vi.fn(),
};

beforeEach(() => {
  vi.spyOn(LoggerModule, 'getLogger').mockReturnValue(mockLogger);
  vi.clearAllMocks();
});

describe('@Loggable decorator', () => {
  it('decorated method returns the correct value', () => {
    class Svc {
      @Loggable
      public double(n: number): number { return n * 2; }
    }
    expect(new Svc().double(5)).toBe(10);
  });

  it('logs [EXEC] methodName on invocation', () => {
    class Svc {
      @Loggable
      public greet(name: string): string { return `hi ${name}`; }
    }
    new Svc().greet('world');
    expect(mockLogger.info).toHaveBeenCalledWith('[EXEC] greet');
  });

  it('preserves this context', () => {
    class Counter {
      private value = 0;
      @Loggable
      public increment(): number { return ++this.value; }
    }
    const c = new Counter();
    expect(c.increment()).toBe(1);
    expect(c.increment()).toBe(2);
  });

  it('works with async methods', async () => {
    class AsyncSvc {
      @Loggable
      public async fetchData(): Promise<string> {
        return Promise.resolve('data');
      }
    }
    const result = await new AsyncSvc().fetchData();
    expect(result).toBe('data');
    expect(mockLogger.info).toHaveBeenCalledWith('[EXEC] fetchData');
  });

  it('each decorated method logs its own name', () => {
    class Multi {
      @Loggable public alpha(): void { /* noop */ }
      @Loggable public beta():  void { /* noop */ }
    }
    const m = new Multi();
    m.alpha();
    m.beta();
    expect(mockLogger.info).toHaveBeenNthCalledWith(1, '[EXEC] alpha');
    expect(mockLogger.info).toHaveBeenNthCalledWith(2, '[EXEC] beta');
  });

  it('does not log before method is called', () => {
    class Idle {
      @Loggable public noop(): void { /* noop */ }
    }
    new Idle();
    expect(mockLogger.info).not.toHaveBeenCalled();
  });

  it('logs once per invocation', () => {
    class Svc {
      @Loggable
      public run(): void { /* noop */ }
    }
    const s = new Svc();
    s.run();
    s.run();
    expect(mockLogger.info).toHaveBeenCalledTimes(2);
  });
});
