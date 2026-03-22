import { describe, it, expect, vi } from 'vitest';
import execute from '../../../src/Scrapers/Pipeline/Runner/PipelineRunner.js';
import { succeed, fail, isSuccess, isFail } from '../../../src/Types/ProcedureHelpers.js';
import type { IPipelineContext } from '../../../src/Scrapers/Pipeline/Types/PipelineContext.js';
import type { INamedStep } from '../../../src/Scrapers/Pipeline/Types/PipelineStep.js';

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

function makeStep(
  name: string,
  fn: (ctx: IPipelineContext) => ReturnType<INamedStep['execute']>
): INamedStep {
  return { execute: fn, meta: { name, description: `Step ${name}` } };
}

describe('PipelineRunner', () => {
  it('returns success for empty pipeline', async () => {
    const result = await execute([], makeCtx());
    expect(result.success).toBe(true);
    if (isSuccess(result)) {
      expect(result.status).toBe('pipeline-complete');
    }
  });

  it('executes steps sequentially and threads context', async () => {
    const ctx = makeCtx();
    const steps: INamedStep[] = [
      makeStep('step-1', async (c) =>
        succeed({ ...c, state: { ...c.state, apiInitialized: true } })),
      makeStep('step-2', async (c) =>
        succeed({ ...c, state: { ...c.state, banksProcessed: 3 } })),
    ];

    const result = await execute(steps, ctx);
    expect(result.success).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.state.apiInitialized).toBe(true);
      expect(result.data.state.banksProcessed).toBe(3);
    }
  });

  it('short-circuits on failure', async () => {
    const step2 = vi.fn();
    const steps: INamedStep[] = [
      makeStep('fail-step', async () => fail('step failed', { status: 'error' })),
      makeStep('never-reached', step2),
    ];

    const result = await execute(steps, makeCtx());
    expect(result.success).toBe(false);
    if (isFail(result)) {
      expect(result.message).toBe('step failed');
      expect(result.status).toContain('fail-step');
    }
    expect(step2).not.toHaveBeenCalled();
  });

  it('aborts on shutdown', async () => {
    const ctx = makeCtx({
      shutdownHandler: {
        isShuttingDown: vi.fn().mockReturnValue(true),
        onShutdown: vi.fn(),
      } as unknown as IPipelineContext['shutdownHandler'],
    });
    const step = vi.fn();
    const steps: INamedStep[] = [makeStep('blocked', step)];

    const result = await execute(steps, ctx);
    expect(result.success).toBe(false);
    if (isFail(result)) {
      expect(result.status).toBe('shutdown');
    }
    expect(step).not.toHaveBeenCalled();
  });

  it('logs step start and completion', async () => {
    const ctx = makeCtx();
    const steps: INamedStep[] = [
      makeStep('logged', async (c) => succeed(c)),
    ];

    await execute(steps, ctx);
    expect(ctx.logger.info).toHaveBeenCalledWith(expect.stringContaining('[logged]'));
  });

  it('logs step failure', async () => {
    const ctx = makeCtx();
    const steps: INamedStep[] = [
      makeStep('broken', async () => fail('oops')),
    ];

    await execute(steps, ctx);
    expect(ctx.logger.error).toHaveBeenCalledWith(expect.stringContaining('[broken] failed'));
  });
});
