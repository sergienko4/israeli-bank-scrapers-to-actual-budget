import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import createProcessAllBanksStep from '../../../src/Scrapers/Pipeline/Steps/ProcessAllBanksStep.js';
import { isSuccess, isFail } from '../../../src/Types/ProcedureHelpers.js';
import type { IPipelineContext } from '../../../src/Scrapers/Pipeline/Types/PipelineContext.js';

function makeCtx(overrides: Partial<IPipelineContext> = {}): IPipelineContext {
  return {
    config: {
      banks: {
        hapoalim: { credentials: { id: '1' } },
        leumi: { credentials: { id: '2' } },
      },
      delayBetweenBanks: 0,
    } as unknown as IPipelineContext['config'],
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    shutdownHandler: { isShuttingDown: vi.fn().mockReturnValue(false), onShutdown: vi.fn() },
    services: {
      metricsService: {
        startImport: vi.fn().mockReturnValue({ success: true, data: { status: 'started' } }),
        startBank: vi.fn(),
        recordBankSuccess: vi.fn(),
        recordBankFailure: vi.fn(),
      },
      bankScraper: {
        scrapeBankWithResilience: vi.fn().mockResolvedValue({ success: true, accounts: [] }),
      },
      accountImporter: {
        processAllAccounts: vi.fn().mockResolvedValue({ imported: 5, skipped: 2 }),
      },
    } as unknown as IPipelineContext['services'],
    state: { isDryRun: false, apiInitialized: true, banksProcessed: 0 },
    ...overrides,
  } as IPipelineContext;
}

describe('ProcessAllBanksStep', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.IMPORT_BANKS;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('processes all configured banks and records metrics', async () => {
    const ctx = makeCtx();
    const step = createProcessAllBanksStep();

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.state.banksProcessed).toBe(2);
      expect(result.data).not.toBe(ctx);
    }
    expect(ctx.services.metricsService.startImport).toHaveBeenCalledOnce();
    expect(ctx.services.metricsService.startBank).toHaveBeenCalledWith('hapoalim');
    expect(ctx.services.metricsService.startBank).toHaveBeenCalledWith('leumi');
    expect(ctx.services.metricsService.recordBankSuccess).toHaveBeenCalledTimes(2);
    expect(ctx.services.bankScraper.scrapeBankWithResilience).toHaveBeenCalledTimes(2);
    expect(ctx.services.accountImporter.processAllAccounts).toHaveBeenCalledTimes(2);
  });

  it('IMPORT_BANKS env filters to specific banks', async () => {
    process.env.IMPORT_BANKS = 'leumi';
    const ctx = makeCtx();
    const step = createProcessAllBanksStep();

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.state.banksProcessed).toBe(1);
    }
    expect(ctx.services.metricsService.startBank).toHaveBeenCalledWith('leumi');
    expect(ctx.services.metricsService.startBank).not.toHaveBeenCalledWith('hapoalim');
  });

  it('IMPORT_BANKS env supports comma-separated values with spaces', async () => {
    process.env.IMPORT_BANKS = 'hapoalim , leumi';
    const ctx = makeCtx();
    const step = createProcessAllBanksStep();

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.state.banksProcessed).toBe(2);
    }
  });

  it('scrape failure records failure metric and continues to next bank', async () => {
    const ctx = makeCtx();
    (ctx.services.bankScraper.scrapeBankWithResilience as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ success: false, errorMessage: 'timeout' })
      .mockResolvedValueOnce({ success: true, accounts: [] });

    const step = createProcessAllBanksStep();
    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      // Only the successful bank's result is counted in data length
      expect(result.data.state.banksProcessed).toBe(1);
    }
    expect(ctx.services.metricsService.recordBankFailure).toHaveBeenCalledWith(
      'hapoalim',
      expect.any(Error)
    );
    expect(ctx.services.metricsService.recordBankSuccess).toHaveBeenCalledWith(
      'leumi', 5, 2
    );
  });

  it('shutdown aborts before processing remaining banks', async () => {
    const ctx = makeCtx({
      shutdownHandler: {
        isShuttingDown: vi.fn().mockReturnValue(true),
        onShutdown: vi.fn(),
      } as unknown as IPipelineContext['shutdownHandler'],
    });
    const step = createProcessAllBanksStep();

    const result = await step(ctx);

    expect(isFail(result)).toBe(true);
    if (isFail(result)) {
      expect(result.status).toBe('banks-failed');
    }
    expect(ctx.services.bankScraper.scrapeBankWithResilience).not.toHaveBeenCalled();
  });

  it('returns a new context object (immutability)', async () => {
    const ctx = makeCtx();
    const step = createProcessAllBanksStep();

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data).not.toBe(ctx);
      expect(result.data.state).not.toBe(ctx.state);
    }
  });

  it('returns fail when metricsService.startImport fails', async () => {
    const ctx = makeCtx();
    (ctx.services.metricsService.startImport as ReturnType<typeof vi.fn>)
      .mockReturnValue({ success: false, message: 'init error' });
    const step = createProcessAllBanksStep();

    const result = await step(ctx);

    expect(isFail(result)).toBe(true);
    if (isFail(result)) {
      expect(result.message).toBe('metrics init failed');
    }
  });

  it('uses default error message when scrapeResult.errorMessage is undefined', async () => {
    const ctx = makeCtx();
    (ctx.services.bankScraper.scrapeBankWithResilience as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ success: false });
    const step = createProcessAllBanksStep();

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    expect(ctx.services.metricsService.recordBankFailure).toHaveBeenCalledWith(
      'hapoalim',
      expect.objectContaining({ message: 'Scrape failed' })
    );
  });

  it('defaults delayBetweenBanks to 0 when config omits it', async () => {
    const ctx = makeCtx({
      config: {
        banks: { single: { credentials: { id: '1' } } },
      } as unknown as IPipelineContext['config'],
    });
    const step = createProcessAllBanksStep();

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.state.banksProcessed).toBe(1);
    }
  });
});
