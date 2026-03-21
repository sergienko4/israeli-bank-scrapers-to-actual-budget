import { describe, it, expect, vi } from 'vitest';
import createEvaluateSpendingWatchStep from '../../../src/Scrapers/Pipeline/Steps/EvaluateSpendingWatchStep.js';
import { succeed, fail, isSuccess } from '../../../src/Types/ProcedureHelpers.js';
import type { IPipelineContext } from '../../../src/Scrapers/Pipeline/Types/PipelineContext.js';

function makeCtx(overrides: Partial<IPipelineContext> = {}): IPipelineContext {
  return {
    config: {
      spendingWatch: [{ category: 'food', limit: 1000 }],
    } as unknown as IPipelineContext['config'],
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    shutdownHandler: { isShuttingDown: vi.fn().mockReturnValue(false), onShutdown: vi.fn() },
    services: {
      notificationService: { sendMessage: vi.fn().mockResolvedValue(undefined) },
    } as unknown as IPipelineContext['services'],
    state: { isDryRun: false, apiInitialized: true, banksProcessed: 2 },
    ...overrides,
  } as IPipelineContext;
}

describe('EvaluateSpendingWatchStep', () => {
  it('dry-run: skips evaluation and sets alertSent false', async () => {
    const watchService = { evaluate: vi.fn() };
    const ctx = makeCtx({
      state: { isDryRun: true, apiInitialized: true, banksProcessed: 0 },
    });
    const step = createEvaluateSpendingWatchStep(watchService);

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.state.alertSent).toBe(false);
      expect(result.data).not.toBe(ctx);
    }
    expect(watchService.evaluate).not.toHaveBeenCalled();
  });

  it('no rules configured (empty array): skips and sets alertSent false', async () => {
    const watchService = { evaluate: vi.fn() };
    const ctx = makeCtx({
      config: { spendingWatch: [] } as unknown as IPipelineContext['config'],
    });
    const step = createEvaluateSpendingWatchStep(watchService);

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.state.alertSent).toBe(false);
    }
    expect(watchService.evaluate).not.toHaveBeenCalled();
  });

  it('no rules configured (undefined): skips and sets alertSent false', async () => {
    const watchService = { evaluate: vi.fn() };
    const ctx = makeCtx({
      config: {} as unknown as IPipelineContext['config'],
    });
    const step = createEvaluateSpendingWatchStep(watchService);

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.state.alertSent).toBe(false);
    }
    expect(watchService.evaluate).not.toHaveBeenCalled();
  });

  it('alert triggered: sends notification and sets alertSent true', async () => {
    const watchService = {
      evaluate: vi.fn().mockResolvedValue(succeed({ message: 'Over budget!' })),
    };
    const ctx = makeCtx();
    const step = createEvaluateSpendingWatchStep(watchService);

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.state.alertSent).toBe(true);
      expect(result.data).not.toBe(ctx);
    }
    expect(watchService.evaluate).toHaveBeenCalledOnce();
    expect(ctx.services.notificationService.sendMessage).toHaveBeenCalledWith('Over budget!');
    expect(ctx.logger.info).toHaveBeenCalledWith(expect.stringContaining('Evaluating'));
  });

  it('no alert: does not send notification and sets alertSent false', async () => {
    const watchService = {
      evaluate: vi.fn().mockResolvedValue(succeed({ noAlerts: true })),
    };
    const ctx = makeCtx();
    const step = createEvaluateSpendingWatchStep(watchService);

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.state.alertSent).toBe(false);
    }
    expect(ctx.services.notificationService.sendMessage).not.toHaveBeenCalled();
  });

  it('evaluate error: warns and sets alertSent false', async () => {
    const watchService = {
      evaluate: vi.fn().mockResolvedValue(fail('db error', { status: 'eval-failed' })),
    };
    const ctx = makeCtx();
    const step = createEvaluateSpendingWatchStep(watchService);

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.state.alertSent).toBe(false);
    }
    expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining('db error'));
    expect(ctx.services.notificationService.sendMessage).not.toHaveBeenCalled();
  });

  it('returns a new context object (immutability)', async () => {
    const watchService = {
      evaluate: vi.fn().mockResolvedValue(succeed({ noAlerts: true })),
    };
    const ctx = makeCtx();
    const step = createEvaluateSpendingWatchStep(watchService);

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data).not.toBe(ctx);
      expect(result.data.state).not.toBe(ctx.state);
    }
  });
});
