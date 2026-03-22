import { describe, it, expect, vi } from 'vitest';
import createInitializeCategoryResolverStep from '../../../src/Scrapers/Pipeline/Steps/InitializeCategoryResolverStep.js';
import { succeed, fail, isSuccess } from '../../../src/Types/ProcedureHelpers.js';
import type { IPipelineContext } from '../../../src/Scrapers/Pipeline/Types/PipelineContext.js';

function makeCtx(overrides: Partial<IPipelineContext> = {}): IPipelineContext {
  return {
    config: {} as IPipelineContext['config'],
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    shutdownHandler: { isShuttingDown: vi.fn().mockReturnValue(false), onShutdown: vi.fn() },
    services: {
      categoryResolver: false,
    } as unknown as IPipelineContext['services'],
    state: { isDryRun: false, apiInitialized: false, banksProcessed: 0 },
    ...overrides,
  } as IPipelineContext;
}

describe('InitializeCategoryResolverStep', () => {
  it('dry-run: skips resolver init and sets resolverReady', async () => {
    const resolver = { initialize: vi.fn() };
    const ctx = makeCtx({
      state: { isDryRun: true, apiInitialized: false, banksProcessed: 0 },
      services: { categoryResolver: resolver } as unknown as IPipelineContext['services'],
    });
    const step = createInitializeCategoryResolverStep();

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.state.resolverReady).toBe(true);
      expect(result.data).not.toBe(ctx);
    }
    expect(resolver.initialize).not.toHaveBeenCalled();
  });

  it('no resolver configured (false): skips and sets resolverReady', async () => {
    const ctx = makeCtx({
      services: { categoryResolver: false } as unknown as IPipelineContext['services'],
    });
    const step = createInitializeCategoryResolverStep();

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.state.resolverReady).toBe(true);
      expect(result.data).not.toBe(ctx);
    }
  });

  it('init success: calls initialize and sets resolverReady', async () => {
    const resolver = { initialize: vi.fn().mockResolvedValue(succeed({ loaded: true })) };
    const ctx = makeCtx({
      services: { categoryResolver: resolver } as unknown as IPipelineContext['services'],
    });
    const step = createInitializeCategoryResolverStep();

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.state.resolverReady).toBe(true);
      expect(result.data).not.toBe(ctx);
    }
    expect(resolver.initialize).toHaveBeenCalledOnce();
    expect(ctx.logger.info).toHaveBeenCalledWith(expect.stringContaining('Loading category resolver'));
  });

  it('init failure: warns but still continues with resolverReady', async () => {
    const resolver = {
      initialize: vi.fn().mockResolvedValue(fail('network error', { status: 'init-failed' })),
    };
    const ctx = makeCtx({
      services: { categoryResolver: resolver } as unknown as IPipelineContext['services'],
    });
    const step = createInitializeCategoryResolverStep();

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.state.resolverReady).toBe(true);
      expect(result.data).not.toBe(ctx);
    }
    expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining('network error'));
    expect(resolver.initialize).toHaveBeenCalledOnce();
  });

  it('returns a new context object (immutability)', async () => {
    const ctx = makeCtx();
    const step = createInitializeCategoryResolverStep();

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data).not.toBe(ctx);
      expect(result.data.state).not.toBe(ctx.state);
    }
  });
});
