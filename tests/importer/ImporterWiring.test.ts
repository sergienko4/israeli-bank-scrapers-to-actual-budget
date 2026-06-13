import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockBuildCoreServices, mockBuildAccountImporter } = vi.hoisted(() => ({
  mockBuildCoreServices: vi.fn(),
  mockBuildAccountImporter: vi.fn(() => ({ kind: 'fake-account-importer' })),
}));
vi.mock('../../src/Importer/CoreServicesWiring.js', () => ({
  buildCoreServices: mockBuildCoreServices,
  buildAccountImporter: mockBuildAccountImporter,
}));

const { mockBuildScrapeStrategy, mockBuildPipeline, mockResolveWatchService } = vi.hoisted(() => ({
  mockBuildScrapeStrategy: vi.fn(() => ({ kind: 'fake-strategy' })),
  mockBuildPipeline: vi.fn(() => [{ kind: 'fake-step' }]),
  mockResolveWatchService: vi.fn(() => ({ kind: 'fake-watch' })),
}));
vi.mock('../../src/Importer/PipelineComposition.js', () => ({
  buildScrapeStrategy: mockBuildScrapeStrategy,
  buildPipeline: mockBuildPipeline,
  resolveWatchService: mockResolveWatchService,
}));

const { MockBankScraper } = vi.hoisted(() => {
  class BankScraper {
    constructor(public readonly deps: unknown) {}
  }
  return { MockBankScraper: BankScraper };
});
vi.mock('../../src/Scraper/BankScraper.js', () => ({
  BankScraper: MockBankScraper,
  createDateRangePolicy: vi.fn(() => ({ kind: 'date-policy' })),
}));
vi.mock('../../src/Scraper/BankRegistry.js', () => ({
  createBankRegistry: vi.fn(() => ({ kind: 'registry' })),
}));
vi.mock('../../src/Scraper/Mappers/DefaultScrapeResultMapper.js', () => ({
  default: vi.fn(() => ({ kind: 'mapper' })),
}));

const { mockCreateInitialContext } = vi.hoisted(() => ({
  mockCreateInitialContext: vi.fn(() => ({ kind: 'fake-context', state: {} })),
}));
vi.mock('../../src/Scrapers/Pipeline/ContextFactory.js', () => ({
  default: mockCreateInitialContext,
}));

import { buildImporter } from '../../src/Importer/ImporterWiring.js';
import type { IImporterConfig } from '../../src/Types/Index.js';

interface IFakeServices {
  isDryRun: boolean;
  notificationService: { kind: string };
  transactionService: unknown;
  reconciliationService: unknown;
  metrics: unknown;
  auditLog: unknown;
  categoryResolver: unknown;
  dryRunCollector: unknown;
}

function makeServices(overrides: Partial<IFakeServices> = {}): IFakeServices {
  return {
    isDryRun: false,
    notificationService: { kind: 'fake-notif' },
    transactionService: { kind: 'fake-txn' },
    reconciliationService: { kind: 'fake-rec' },
    metrics: { kind: 'fake-metrics' },
    auditLog: { kind: 'fake-audit' },
    categoryResolver: undefined,
    dryRunCollector: { kind: 'fake-dry' },
    ...overrides,
  };
}

function makeResilience(): { shutdownHandler: unknown; retryStrategy: unknown; noRetryStrategy: unknown; timeoutWrapper: unknown; errorFormatter: unknown } {
  return {
    shutdownHandler: { kind: 'shutdown' },
    retryStrategy: { kind: 'retry' },
    noRetryStrategy: { kind: 'noretry' },
    timeoutWrapper: { kind: 'timeout' },
    errorFormatter: { kind: 'errfmt' },
  };
}

function makeLogger(): { info: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } {
  return { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('ImporterWiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildScrapeStrategy.mockReturnValue({ kind: 'fake-strategy' });
    mockBuildPipeline.mockReturnValue([{ kind: 'fake-step' }] as never);
    mockResolveWatchService.mockReturnValue({ kind: 'fake-watch' } as never);
    mockBuildAccountImporter.mockReturnValue({ kind: 'fake-account-importer' } as never);
    mockCreateInitialContext.mockReturnValue({ kind: 'fake-context', state: {} } as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('buildImporter', () => {
    it('returns the IImporterWiring shape with pipeline + context + flags', () => {
      mockBuildCoreServices.mockReturnValue(makeServices() as never);

      const wiring = buildImporter({} as IImporterConfig, makeResilience() as never, makeLogger() as never);

      expect(wiring).toHaveProperty('pipeline');
      expect(wiring).toHaveProperty('pipelineContext');
      expect(wiring).toHaveProperty('notificationService');
      expect(wiring).toHaveProperty('isDryRun');
      expect(wiring).toHaveProperty('hasProxy');
    });

    it('propagates services.isDryRun to wiring.isDryRun', () => {
      mockBuildCoreServices.mockReturnValue(makeServices({ isDryRun: true }) as never);

      const wiring = buildImporter({} as IImporterConfig, makeResilience() as never, makeLogger() as never);

      expect(wiring.isDryRun).toBe(true);
    });

    it('reports hasProxy=true when config.proxy.server is set', () => {
      mockBuildCoreServices.mockReturnValue(makeServices() as never);

      const wiring = buildImporter(
        { proxy: { server: 'http://corp.proxy:8080' } } as IImporterConfig,
        makeResilience() as never,
        makeLogger() as never
      );

      expect(wiring.hasProxy).toBe(true);
    });

    it('reports hasProxy=false when config.proxy is undefined', () => {
      mockBuildCoreServices.mockReturnValue(makeServices() as never);

      const wiring = buildImporter({} as IImporterConfig, makeResilience() as never, makeLogger() as never);

      expect(wiring.hasProxy).toBe(false);
    });

    it('forwards notificationService from services to wiring', () => {
      const services = makeServices();
      mockBuildCoreServices.mockReturnValue(services as never);

      const wiring = buildImporter({} as IImporterConfig, makeResilience() as never, makeLogger() as never);

      expect(wiring.notificationService).toBe(services.notificationService);
    });

    it('invokes buildPipeline with the resolved watch service', () => {
      mockBuildCoreServices.mockReturnValue(makeServices() as never);
      const watch = { kind: 'specific-watch' };
      mockResolveWatchService.mockReturnValue(watch as never);

      buildImporter({} as IImporterConfig, makeResilience() as never, makeLogger() as never);

      expect(mockBuildPipeline).toHaveBeenCalledWith(watch);
    });
  });
});
