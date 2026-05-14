import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLogger } from '../../src/Logger/Index.js';
import { loggable } from '../../src/Utils/Loggable.js';

vi.mock('../../src/Logger/Index.js', () => ({
  getLogger: vi.fn(),
}));

const mockLogger = {
  info:  vi.fn(),
  debug: vi.fn(),
  warn:  vi.fn(),
  error: vi.fn(),
};

beforeEach(() => {
  vi.mocked(getLogger).mockReturnValue(mockLogger);
  vi.clearAllMocks();
});

/**
 * Tests invoke `loggable()` as a plain function — semantically identical
 * to applying `@loggable` as a TC39 Stage 3 class-method decorator, but
 * the explicit form avoids needing a Babel transform pass in the unit
 * suite (vitest 4 + vite 8 handle plain TypeScript natively).
 *
 * @param fn - The method body to wrap.
 * @param name - The method name that should be logged on invocation.
 * @returns A `loggable`-wrapped function ready to assign to a class field.
 */
function decorate<TThis, TArgs extends unknown[], TReturn>(
  fn: (this: TThis, ...args: TArgs) => TReturn,
  name: string,
): (this: TThis, ...args: TArgs) => TReturn {
  return loggable(fn, { kind: 'method', name } as ClassMethodDecoratorContext<
    TThis,
    (this: TThis, ...args: TArgs) => TReturn
  >);
}

describe('loggable decorator', () => {
  it('decorated method returns the correct value', () => {
    class Svc {
      public double = decorate(function (this: Svc, n: number): number {
        return n * 2;
      }, 'double');
    }
    expect(new Svc().double(5)).toBe(10);
  });

  it('logs [EXEC] methodName on invocation', () => {
    class Svc {
      public greet = decorate(function (this: Svc, name: string): string {
        return `hi ${name}`;
      }, 'greet');
    }
    new Svc().greet('world');
    expect(mockLogger.info).toHaveBeenCalledWith('[EXEC] greet');
  });

  it('preserves this context', () => {
    class Counter {
      private value = 0;
      public increment = decorate(function (this: Counter): number {
        return ++this.value;
      }, 'increment');
    }
    const c = new Counter();
    expect(c.increment()).toBe(1);
    expect(c.increment()).toBe(2);
  });

  it('works with async methods', async () => {
    class AsyncSvc {
      public fetchData = decorate(async function (this: AsyncSvc): Promise<string> {
        return 'data';
      }, 'fetchData');
    }
    const result = await new AsyncSvc().fetchData();
    expect(result).toBe('data');
    expect(mockLogger.info).toHaveBeenCalledWith('[EXEC] fetchData');
  });

  it('each decorated method logs its own name', () => {
    class Multi {
      public alpha = decorate(function (this: Multi): void { /* noop */ }, 'alpha');
      public beta  = decorate(function (this: Multi): void { /* noop */ }, 'beta');
    }
    const m = new Multi();
    m.alpha();
    m.beta();
    expect(mockLogger.info).toHaveBeenNthCalledWith(1, '[EXEC] alpha');
    expect(mockLogger.info).toHaveBeenNthCalledWith(2, '[EXEC] beta');
  });

  it('does not log before method is called', () => {
    class Idle {
      public noop = decorate(function (this: Idle): void { /* noop */ }, 'noop');
    }
    const _idle = new Idle();
    expect(mockLogger.info).not.toHaveBeenCalled();
  });

  it('logs once per invocation', () => {
    class Svc {
      public run = decorate(function (this: Svc): void { /* noop */ }, 'run');
    }
    const s = new Svc();
    s.run();
    s.run();
    expect(mockLogger.info).toHaveBeenCalledTimes(2);
  });
});
