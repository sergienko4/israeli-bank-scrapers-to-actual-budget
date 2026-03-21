import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import createInitializeApiStep from '../../../src/Scrapers/Pipeline/Steps/InitializeApiStep.js';
import { isSuccess, isFail } from '../../../src/Types/ProcedureHelpers.js';
import type { IPipelineContext } from '../../../src/Scrapers/Pipeline/Types/PipelineContext.js';

function makeCtx(overrides: Partial<IPipelineContext> = {}): IPipelineContext {
  return {
    config: {
      actual: {
        init: { dataDir: '/tmp/data', serverURL: 'https://actual.example.com', password: 'server-pw' },
        budget: { syncId: 'budget-123', password: 'budget-pw' },
      },
    } as unknown as IPipelineContext['config'],
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    shutdownHandler: { isShuttingDown: vi.fn().mockReturnValue(false), onShutdown: vi.fn() },
    services: {} as IPipelineContext['services'],
    state: { isDryRun: false, apiInitialized: false, banksProcessed: 0 },
    ...overrides,
  } as IPipelineContext;
}

function makeApi() {
  return {
    init: vi.fn().mockResolvedValue({}),
    loadBudget: vi.fn().mockResolvedValue(undefined),
    downloadBudget: vi.fn().mockResolvedValue(undefined),
  };
}

describe('InitializeApiStep', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.E2E_LOCAL_BUDGET_ID;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('local mode: initializes API and loads budget by E2E_LOCAL_BUDGET_ID', async () => {
    process.env.E2E_LOCAL_BUDGET_ID = 'local-id-42';
    const api = makeApi();
    const ctx = makeCtx();
    const step = createInitializeApiStep(api);

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.state.apiInitialized).toBe(true);
      expect(result.data).not.toBe(ctx);
    }
    expect(api.init).toHaveBeenCalledWith({ dataDir: '/tmp/data' });
    expect(api.loadBudget).toHaveBeenCalledWith('local-id-42');
    expect(api.downloadBudget).not.toHaveBeenCalled();
    expect(ctx.logger.info).toHaveBeenCalledWith(expect.stringContaining('local mode'));
  });

  it('server mode: connects to server and downloads budget', async () => {
    const api = makeApi();
    const ctx = makeCtx();
    const step = createInitializeApiStep(api);

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.state.apiInitialized).toBe(true);
      expect(result.data).not.toBe(ctx);
    }
    expect(api.init).toHaveBeenCalledWith({
      dataDir: '/tmp/data',
      serverURL: 'https://actual.example.com',
      password: 'server-pw',
    });
    expect(api.downloadBudget).toHaveBeenCalledWith('budget-123', { password: 'budget-pw' });
    expect(api.loadBudget).not.toHaveBeenCalled();
    expect(ctx.logger.info).toHaveBeenCalledWith(expect.stringContaining('Connecting'));
  });

  it('server mode: omits budget password when not configured', async () => {
    const api = makeApi();
    const ctx = makeCtx({
      config: {
        actual: {
          init: { dataDir: '/tmp/data', serverURL: 'https://actual.example.com', password: 'pw' },
          budget: { syncId: 'budget-123', password: '' },
        },
      } as unknown as IPipelineContext['config'],
    });
    const step = createInitializeApiStep(api);

    await step(ctx);

    expect(api.downloadBudget).toHaveBeenCalledWith('budget-123', {});
  });

  it('local mode: returns failure when init throws', async () => {
    process.env.E2E_LOCAL_BUDGET_ID = 'local-id-42';
    const api = makeApi();
    api.init.mockRejectedValue(new Error('ENOENT'));
    const ctx = makeCtx();
    const step = createInitializeApiStep(api);

    const result = await step(ctx);

    expect(isFail(result)).toBe(true);
    if (isFail(result)) {
      expect(result.message).toBe('Failed to initialize local API');
      expect(result.status).toBe('api-init-failed');
    }
  });

  it('local mode: wraps string errors into Error instances', async () => {
    process.env.E2E_LOCAL_BUDGET_ID = 'local-id-42';
    const api = makeApi();
    api.loadBudget.mockRejectedValue('string error');
    const ctx = makeCtx();
    const step = createInitializeApiStep(api);

    const result = await step(ctx);

    expect(isFail(result)).toBe(true);
    if (isFail(result)) {
      expect(result.error).toBeInstanceOf(Error);
    }
  });

  it('server mode: returns failure when downloadBudget throws', async () => {
    const api = makeApi();
    api.downloadBudget.mockRejectedValue(new Error('network error'));
    const ctx = makeCtx();
    const step = createInitializeApiStep(api);

    const result = await step(ctx);

    expect(isFail(result)).toBe(true);
    if (isFail(result)) {
      expect(result.message).toBe('Failed to initialize server API');
      expect(result.status).toBe('api-init-failed');
    }
  });

  it('returns a new context object (immutability)', async () => {
    const api = makeApi();
    const ctx = makeCtx();
    const step = createInitializeApiStep(api);

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data).not.toBe(ctx);
      expect(result.data.state).not.toBe(ctx.state);
    }
  });
});
