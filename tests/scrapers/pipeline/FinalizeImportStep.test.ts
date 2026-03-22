import { describe, it, expect, vi } from 'vitest';
import createFinalizeImportStep from '../../../src/Scrapers/Pipeline/Steps/FinalizeImportStep.js';
import { isSuccess } from '../../../src/Types/ProcedureHelpers.js';
import type { IPipelineContext } from '../../../src/Scrapers/Pipeline/Types/PipelineContext.js';

function makeCtx(overrides: Partial<IPipelineContext> = {}): IPipelineContext {
  return {
    config: {} as IPipelineContext['config'],
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    shutdownHandler: { isShuttingDown: vi.fn().mockReturnValue(false), onShutdown: vi.fn() },
    services: {
      metricsService: {
        printSummary: vi.fn().mockReturnValue({ success: true, status: 'ok', data: { status: 'printed' } }),
        getSummary: vi.fn().mockReturnValue({ success: true, status: 'ok', data: { total: 10, imported: 8, skipped: 2 } }),
        hasFailures: vi.fn().mockReturnValue({ success: true, status: 'ok', data: false }),
      },
      auditLogService: { record: vi.fn().mockReturnValue({ success: true, status: 'ok', data: { status: 'recorded' } }) },
      notificationService: {
        sendSummary: vi.fn().mockResolvedValue({ success: true, status: 'ok', data: { sent: 1 } }),
        sendMessage: vi.fn().mockResolvedValue({ success: true, status: 'ok', data: { sent: 1 } }),
      },
      dryRunCollector: {
        formatText: vi.fn().mockReturnValue('=== DRY-RUN PREVIEW ==='),
        formatTelegram: vi.fn().mockReturnValue('<b>Dry Run</b>'),
      },
    } as unknown as IPipelineContext['services'],
    state: { isDryRun: false, apiInitialized: true, banksProcessed: 2 },
    ...overrides,
  } as IPipelineContext;
}

function makeApi() {
  return { shutdown: vi.fn().mockResolvedValue(undefined) };
}

describe('FinalizeImportStep', () => {
  it('normal mode: records audit, sends summary, shuts down API', async () => {
    const api = makeApi();
    const ctx = makeCtx();
    const step = createFinalizeImportStep(api);

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    expect(ctx.services.metricsService.printSummary).toHaveBeenCalledOnce();
    expect(ctx.services.metricsService.getSummary).toHaveBeenCalledOnce();
    expect(ctx.services.auditLogService.record).toHaveBeenCalledWith(
      { total: 10, imported: 8, skipped: 2 }
    );
    expect(ctx.services.notificationService.sendSummary).toHaveBeenCalledWith(
      { total: 10, imported: 8, skipped: 2 }
    );
    expect(api.shutdown).toHaveBeenCalledOnce();
    expect(ctx.logger.info).toHaveBeenCalledWith(expect.stringContaining('completed'));
  });

  it('normal mode: skips audit/notification when getSummary fails', async () => {
    const api = makeApi();
    const ctx = makeCtx();
    (ctx.services.metricsService.getSummary as ReturnType<typeof vi.fn>)
      .mockReturnValue({ success: false, status: 'error', message: 'no data' });
    const step = createFinalizeImportStep(api);

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    expect(ctx.services.auditLogService.record).not.toHaveBeenCalled();
    expect(ctx.services.notificationService.sendSummary).not.toHaveBeenCalled();
    expect(api.shutdown).toHaveBeenCalledOnce();
  });

  it('dry-run mode: logs preview, sends telegram, shuts down API', async () => {
    const api = makeApi();
    const ctx = makeCtx({
      state: { isDryRun: true, apiInitialized: true, banksProcessed: 0 },
    });
    const step = createFinalizeImportStep(api);

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.state.exitCode).toBe(0);
      expect(result.data).not.toBe(ctx);
    }
    expect(ctx.services.dryRunCollector.formatText).toHaveBeenCalledOnce();
    expect(ctx.logger.info).toHaveBeenCalledWith('=== DRY-RUN PREVIEW ===');
    expect(ctx.services.dryRunCollector.formatTelegram).toHaveBeenCalledOnce();
    expect(ctx.services.notificationService.sendMessage).toHaveBeenCalledWith('<b>Dry Run</b>');
    expect(api.shutdown).toHaveBeenCalledOnce();
    // Should NOT do normal import finalization
    expect(ctx.services.auditLogService.record).not.toHaveBeenCalled();
    expect(ctx.services.notificationService.sendSummary).not.toHaveBeenCalled();
  });

  it('exit code 0 when no failures', async () => {
    const api = makeApi();
    const ctx = makeCtx();
    (ctx.services.metricsService.hasFailures as ReturnType<typeof vi.fn>)
      .mockReturnValue({ success: true, data: false });
    const step = createFinalizeImportStep(api);

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.state.exitCode).toBe(0);
    }
  });

  it('exit code 1 when there are failures', async () => {
    const api = makeApi();
    const ctx = makeCtx();
    (ctx.services.metricsService.hasFailures as ReturnType<typeof vi.fn>)
      .mockReturnValue({ success: true, data: true });
    const step = createFinalizeImportStep(api);

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.state.exitCode).toBe(1);
    }
  });

  it('exit code 1 when hasFailures returns unsuccessful result (fail-safe)', async () => {
    const api = makeApi();
    const ctx = makeCtx();
    (ctx.services.metricsService.hasFailures as ReturnType<typeof vi.fn>)
      .mockReturnValue({ success: false, status: 'error', message: 'metrics error' });
    const step = createFinalizeImportStep(api);

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.state.exitCode).toBe(1);
    }
  });

  it('always prints summary first', async () => {
    const api = makeApi();
    const ctx = makeCtx();
    const step = createFinalizeImportStep(api);

    await step(ctx);

    expect(ctx.services.metricsService.printSummary).toHaveBeenCalledOnce();
  });

  it('returns a new context object (immutability)', async () => {
    const api = makeApi();
    const ctx = makeCtx();
    const step = createFinalizeImportStep(api);

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data).not.toBe(ctx);
      expect(result.data.state).not.toBe(ctx.state);
    }
  });

  it('logs warning when printSummary fails', async () => {
    const api = makeApi();
    const ctx = makeCtx();
    (ctx.services.metricsService.printSummary as ReturnType<typeof vi.fn>)
      .mockReturnValue({ success: false, status: 'error', message: 'print broke' });
    const step = createFinalizeImportStep(api);

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    expect(ctx.logger.warn).toHaveBeenCalledWith('printSummary failed: print broke');
    expect(api.shutdown).toHaveBeenCalledOnce();
  });

  it('logs warning when audit record fails', async () => {
    const api = makeApi();
    const ctx = makeCtx();
    (ctx.services.auditLogService.record as ReturnType<typeof vi.fn>)
      .mockReturnValue({ success: false, status: 'error', message: 'audit db down' });
    const step = createFinalizeImportStep(api);

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    expect(ctx.logger.warn).toHaveBeenCalledWith('audit record failed: audit db down');
    // sendSummary should still be called even if record fails
    expect(ctx.services.notificationService.sendSummary).toHaveBeenCalledOnce();
  });

  it('logs warning when sendSummary fails', async () => {
    const api = makeApi();
    const ctx = makeCtx();
    (ctx.services.notificationService.sendSummary as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ success: false, status: 'error', message: 'telegram down' });
    const step = createFinalizeImportStep(api);

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    expect(ctx.logger.warn).toHaveBeenCalledWith('sendSummary failed: telegram down');
  });

  it('dry-run: logs warning when sendMessage fails', async () => {
    const api = makeApi();
    const ctx = makeCtx({
      state: { isDryRun: true, apiInitialized: true, banksProcessed: 0 },
    });
    (ctx.services.notificationService.sendMessage as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ success: false, status: 'error', message: 'msg send error' });
    const step = createFinalizeImportStep(api);

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.state.exitCode).toBe(0);
    }
    expect(ctx.logger.warn).toHaveBeenCalledWith('sendMessage failed: msg send error');
  });

  it('shuts down API even when finalize throws', async () => {
    const api = makeApi();
    const ctx = makeCtx();
    // Force an error inside dispatchFinalize by making getSummary throw
    (ctx.services.metricsService.getSummary as ReturnType<typeof vi.fn>)
      .mockImplementation(() => { throw new Error('unexpected'); });
    const step = createFinalizeImportStep(api);

    await expect(step(ctx)).rejects.toThrow('unexpected');
    expect(api.shutdown).toHaveBeenCalledOnce();
  });

  it('suppresses shutdown error in finally block', async () => {
    const api = { shutdown: vi.fn().mockRejectedValue(new Error('shutdown boom')) };
    const ctx = makeCtx();
    const step = createFinalizeImportStep(api);

    const result = await step(ctx);

    // The step still succeeds despite shutdown failure
    expect(isSuccess(result)).toBe(true);
    expect(api.shutdown).toHaveBeenCalledOnce();
  });

  it('exit code defaults to 1 when EXIT_CODE map has no matching key', async () => {
    const api = makeApi();
    const ctx = makeCtx();
    // Return a non-boolean data value so String(data) is not 'true' or 'false'
    (ctx.services.metricsService.hasFailures as ReturnType<typeof vi.fn>)
      .mockReturnValue({ success: true, status: 'ok', data: 'unknown' });
    const step = createFinalizeImportStep(api);

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.state.exitCode).toBe(1);
    }
  });
});
