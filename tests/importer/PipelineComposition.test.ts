import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { MockMockScrapeStrategy, MockLiveScrapeStrategy, MockSpendingWatch } = vi.hoisted(() => {
  class MockScrape {
    constructor(public readonly opts: unknown) {}
  }
  class LiveScrape {
    constructor(public readonly opts: unknown) {}
  }
  class SpendingWatch {
    constructor(public readonly rules: unknown, public readonly api: unknown) {}
  }
  return {
    MockMockScrapeStrategy: MockScrape,
    MockLiveScrapeStrategy: LiveScrape,
    MockSpendingWatch: SpendingWatch,
  };
});
vi.mock('../../src/Scraper/Strategies/MockScrapeStrategy.js', () => ({
  MockScrapeStrategy: MockMockScrapeStrategy,
}));
vi.mock('../../src/Scraper/Strategies/LiveScrapeStrategy.js', () => ({
  LiveScrapeStrategy: MockLiveScrapeStrategy,
}));
vi.mock('../../src/Services/SpendingWatchService.js', () => ({
  default: MockSpendingWatch,
}));
vi.mock('@actual-app/api', () => ({
  default: { kind: 'fake-actual-api' },
}));

import {
  NO_OP_WATCH,
  buildPipeline,
  buildScrapeStrategy,
  resolveWatchService,
  type IScrapeStrategyInputs,
} from '../../src/Importer/PipelineComposition.js';
import { isSuccess } from '../../src/Types/ProcedureHelpers.js';
import type { IImporterConfig } from '../../src/Types/Index.js';

function makeInputs(): IScrapeStrategyInputs {
  return {
    config: {} as IImporterConfig,
    resilience: {
      retryStrategy: { kind: 'retry' },
      noRetryStrategy: { kind: 'noretry' },
      timeoutWrapper: { kind: 'timeout' },
    } as never,
    services: {
      twoFactorPrompter: null,
      notificationService: { kind: 'notif' },
    } as never,
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
  };
}

describe('PipelineComposition', () => {
  let originalDir: string | undefined;
  let originalFile: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalDir = process.env.E2E_MOCK_SCRAPER_DIR;
    originalFile = process.env.E2E_MOCK_SCRAPER_FILE;
    delete process.env.E2E_MOCK_SCRAPER_DIR;
    delete process.env.E2E_MOCK_SCRAPER_FILE;
  });

  afterEach(() => {
    if (originalDir === undefined) delete process.env.E2E_MOCK_SCRAPER_DIR;
    else process.env.E2E_MOCK_SCRAPER_DIR = originalDir;
    if (originalFile === undefined) delete process.env.E2E_MOCK_SCRAPER_FILE;
    else process.env.E2E_MOCK_SCRAPER_FILE = originalFile;
  });

  describe('NO_OP_WATCH', () => {
    it('evaluate() returns a success procedure with noAlerts=true', async () => {
      const result = await NO_OP_WATCH.evaluate();

      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) {
        expect(result.data.noAlerts).toBe(true);
      }
    });
  });

  describe('buildScrapeStrategy', () => {
    it('returns a MockScrapeStrategy when E2E_MOCK_SCRAPER_DIR is set', () => {
      process.env.E2E_MOCK_SCRAPER_DIR = '/fake/dir';

      const strategy = buildScrapeStrategy(makeInputs());

      expect(strategy).toBeInstanceOf(MockMockScrapeStrategy);
    });

    it('returns a MockScrapeStrategy when E2E_MOCK_SCRAPER_FILE is set', () => {
      process.env.E2E_MOCK_SCRAPER_FILE = '/fake/file.json';

      const strategy = buildScrapeStrategy(makeInputs());

      expect(strategy).toBeInstanceOf(MockMockScrapeStrategy);
    });

    it('returns a LiveScrapeStrategy when no E2E mock env vars are set', () => {
      const strategy = buildScrapeStrategy(makeInputs());

      expect(strategy).toBeInstanceOf(MockLiveScrapeStrategy);
    });

    it('passes resilience + services dependencies to LiveScrapeStrategy', () => {
      const inputs = makeInputs();
      const strategy = buildScrapeStrategy(inputs) as unknown as { opts: Record<string, unknown> };

      expect(strategy.opts.retryStrategy).toBe(inputs.resilience.retryStrategy);
      expect(strategy.opts.noRetryStrategy).toBe(inputs.resilience.noRetryStrategy);
      expect(strategy.opts.timeoutWrapper).toBe(inputs.resilience.timeoutWrapper);
      expect(strategy.opts.notificationService).toBe(inputs.services.notificationService);
    });
  });

  describe('resolveWatchService', () => {
    it('returns NO_OP_WATCH when spendingWatch is undefined', () => {
      const service = resolveWatchService({} as IImporterConfig);

      expect(service).toBe(NO_OP_WATCH);
    });

    it('returns NO_OP_WATCH when spendingWatch is an empty array', () => {
      const service = resolveWatchService({ spendingWatch: [] } as never);

      expect(service).toBe(NO_OP_WATCH);
    });

    it('returns a SpendingWatchService when spendingWatch rules are present', () => {
      const rules = [{ kind: 'rule-a' }];
      const service = resolveWatchService({ spendingWatch: rules } as never);

      expect(service).toBeInstanceOf(MockSpendingWatch);
    });
  });

  describe('buildPipeline', () => {
    it('returns the 5 named pipeline steps in order', () => {
      const steps = buildPipeline(NO_OP_WATCH);

      expect(steps).toHaveLength(5);
      expect(steps.map((s) => s.meta.name)).toEqual([
        'init-api',
        'init-resolver',
        'process-banks',
        'spending-watch',
        'finalize',
      ]);
    });
  });
});
