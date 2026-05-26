import { afterEach,beforeEach, describe, expect, it, vi } from 'vitest';

import createProcessAllBanksStep from '../../../src/Scrapers/Pipeline/Steps/ProcessAllBanksStep.js';
import type { IPipelineContext } from '../../../src/Scrapers/Pipeline/Types/PipelineContext.js';
import { isFail, isSuccess } from '../../../src/Types/ProcedureHelpers.js';
import {
  ALLOW_ALL_BANK_FILTER, fakeBankConfig, fakeCanonicalScrapeResult,
  fakePipelineConfig,
} from '../../helpers/factories.js';

function makeMockMapper() {
  return {
    mapToCanonical: vi.fn(),
    canonicalToLegacy: vi.fn(),
    legacyToCanonical: vi.fn().mockReturnValue({
      success: true,
      data: fakeCanonicalScrapeResult({ bankId: 'mock', accounts: [] }),
    }),
  };
}

function makeCtx(overrides: Partial<IPipelineContext> = {}): IPipelineContext {
  const mergedConfig = (overrides.config
    ?? fakePipelineConfig({
      banks: { hapoalim: fakeBankConfig(), leumi: fakeBankConfig() },
    })) as IPipelineContext['config'];
  return {
    config: mergedConfig,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    shutdownHandler: { isShuttingDown: vi.fn().mockReturnValue(false), onShutdown: vi.fn() },
    services: {
      metricsService: {
        startImport: vi.fn().mockReturnValue({ success: true, data: { status: 'started' } }),
        startBank: vi.fn().mockReturnValue({ success: true, data: { status: 'tracking' } }),
        recordBankSuccess: vi.fn().mockReturnValue({ success: true, data: { status: 'recorded' } }),
        recordBankFailure: vi.fn().mockReturnValue({ success: true, data: { status: 'recorded' } }),
      },
      bankScraper: {
        scrapeBankWithResilience: vi.fn().mockResolvedValue({ success: true, accounts: [] }),
      },
      accountImporter: {
        processAllAccounts: vi.fn().mockResolvedValue({ imported: 5, skipped: 2 }),
      },
      scrapeResultMapper: makeMockMapper(),
    } as unknown as IPipelineContext['services'],
    state: { isDryRun: false, apiInitialized: true, banksProcessed: 0 },
    ...overrides,
  } as IPipelineContext;
}

describe('ProcessAllBanksStep', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('processes all configured banks and emits metrics deltas via reducer', async () => {
    const ctx = makeCtx();
    const step = createProcessAllBanksStep();

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.state.banksProcessed).toBe(2);
      expect(result.data.state.bankResults?.successful).toHaveLength(2);
      expect(result.data.state.bankResults?.quarantined).toHaveLength(0);
      expect(result.data.state.bankResults?.totalBanks).toBe(2);
    }
    expect(ctx.services.metricsService.startImport).toHaveBeenCalledOnce();
    expect(ctx.services.metricsService.startBank).toHaveBeenCalledWith('hapoalim');
    expect(ctx.services.metricsService.startBank).toHaveBeenCalledWith('leumi');
    expect(ctx.services.metricsService.recordBankSuccess).toHaveBeenCalledTimes(2);
    expect(ctx.services.bankScraper.scrapeBankWithResilience).toHaveBeenCalledTimes(2);
    expect(ctx.services.accountImporter.processAllAccounts).toHaveBeenCalledTimes(2);
  });

  it('bankFilter restricts processing to selected banks', async () => {
    const ctx = makeCtx({
      config: fakePipelineConfig({
        banks: { hapoalim: fakeBankConfig(), leumi: fakeBankConfig() },
        bankFilter: { matches: (name: string): boolean => name === 'leumi' },
      }) as unknown as IPipelineContext['config'],
    });
    const step = createProcessAllBanksStep();

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.state.banksProcessed).toBe(1);
      expect(result.data.state.bankResults?.totalBanks).toBe(1);
    }
    expect(ctx.services.metricsService.startBank).toHaveBeenCalledWith('leumi');
    expect(ctx.services.metricsService.startBank).not.toHaveBeenCalledWith('hapoalim');
  });

  it('does not read process.env (INV-1)', async () => {
    process.env.IMPORT_BANKS = 'leumi';
    const ctx = makeCtx();
    const step = createProcessAllBanksStep();

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.state.banksProcessed).toBe(2);
    }
  });

  it('scrape failure quarantines bank and continues batch (partial success)', async () => {
    const ctx = makeCtx();
    (ctx.services.bankScraper.scrapeBankWithResilience as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ success: false, errorMessage: 'timeout' })
      .mockResolvedValueOnce({ success: true, accounts: [] });

    const step = createProcessAllBanksStep();
    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.state.banksProcessed).toBe(1);
      expect(result.data.state.bankResults?.successful).toHaveLength(1);
      expect(result.data.state.bankResults?.quarantined).toHaveLength(1);
      expect(result.data.state.bankResults?.quarantined[0]?.stage).toBe('scrape');
    }
    expect(ctx.services.metricsService.recordBankFailure).toHaveBeenCalledWith(
      'hapoalim',
      expect.any(Error)
    );
    expect(ctx.services.metricsService.recordBankSuccess).toHaveBeenCalledWith(
      'leumi', 5, 2
    );
  });

  it('preserves original Error reference (INV-3)', async () => {
    const ctx = makeCtx();
    const originalErr = new Error('boom');
    (ctx.services.accountImporter.processAllAccounts as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(originalErr);

    const step = createProcessAllBanksStep();
    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      const q = result.data.state.bankResults?.quarantined[0];
      expect(q?.stage).toBe('import');
      expect(q?.error).toBe(originalErr);
    }
  });

  it('map-stage failure quarantines with stage=map and preserves Error (INV-3)', async () => {
    const ctx = makeCtx();
    const mapErr = new Error('canonicalize crashed');
    (ctx.services.scrapeResultMapper.legacyToCanonical as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({
        success: false, message: 'canonicalize crashed',
        status: 'legacy-not-successful', error: mapErr,
      });

    const step = createProcessAllBanksStep();
    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      const q = result.data.state.bankResults?.quarantined[0];
      expect(q?.stage).toBe('map');
      expect(q?.error).toBe(mapErr);
    }
    expect(ctx.services.metricsService.recordBankFailure).toHaveBeenCalledWith(
      'hapoalim', mapErr
    );
  });

  it('all banks failing returns fail with banks-failed status (INV-4)', async () => {
    const ctx = makeCtx();
    (ctx.services.bankScraper.scrapeBankWithResilience as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ success: false, errorMessage: 'timeout' });

    const step = createProcessAllBanksStep();
    const result = await step(ctx);

    expect(isFail(result)).toBe(true);
    if (isFail(result)) {
      expect(result.status).toBe('banks-failed');
    }
  });

  it('shutdown aborts before processing any banks', async () => {
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
      expect(result.status).toBe('shutdown');
    }
    expect(ctx.services.metricsService.startImport).not.toHaveBeenCalled();
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

    await step(ctx);

    expect(ctx.services.metricsService.recordBankFailure).toHaveBeenCalledWith(
      'hapoalim',
      expect.objectContaining({ message: 'Scrape failed' })
    );
  });

  it('defaults delayBetweenBanks to 0 when config omits it', async () => {
    const cfg = fakePipelineConfig({
      banks: { single: fakeBankConfig() },
    }) as unknown as IPipelineContext['config'] & { delayBetweenBanks?: number };
    delete cfg.delayBetweenBanks;
    const ctx = makeCtx({ config: cfg });
    const step = createProcessAllBanksStep();

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.state.banksProcessed).toBe(1);
    }
  });

  it('treats empty bank list as success with totalBanks=0', async () => {
    const ctx = makeCtx({
      config: fakePipelineConfig({
        banks: {},
        bankFilter: ALLOW_ALL_BANK_FILTER,
      }) as unknown as IPipelineContext['config'],
    });
    const step = createProcessAllBanksStep();

    const result = await step(ctx);

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.data.state.banksProcessed).toBe(0);
      expect(result.data.state.bankResults?.totalBanks).toBe(0);
    }
  });
});
