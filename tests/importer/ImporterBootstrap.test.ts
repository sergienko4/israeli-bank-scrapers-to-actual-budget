import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fail, succeed } from '../../src/Types/ProcedureHelpers.js';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../src/Logger/Index.js', () => ({
  getLogger: () => mockLogger,
  createLogger: vi.fn(),
  getLogBuffer: vi.fn(),
  deriveLogFormat: vi.fn(() => 'words'),
}));

const { mockBootConfigAndLogger, mockHandleValidateMode } = vi.hoisted(() => ({
  mockBootConfigAndLogger: vi.fn(),
  mockHandleValidateMode: vi.fn(),
}));
vi.mock('../../src/Importer/ConfigBootstrap.js', () => ({
  bootConfigAndLogger: mockBootConfigAndLogger,
  handleValidateMode: mockHandleValidateMode,
}));

const { mockBuildResilience } = vi.hoisted(() => ({
  mockBuildResilience: vi.fn(),
}));
vi.mock('../../src/Importer/ResilienceWiring.js', () => ({
  buildResilienceComponents: mockBuildResilience,
}));

const { mockBuildImporter } = vi.hoisted(() => ({
  mockBuildImporter: vi.fn(),
}));
vi.mock('../../src/Importer/ImporterWiring.js', () => ({
  buildImporter: mockBuildImporter,
}));

const { mockBuildLifecycle } = vi.hoisted(() => ({
  mockBuildLifecycle: vi.fn(),
}));
vi.mock('../../src/Importer/ProcessLifecycle.js', () => ({
  buildProcessLifecycle: mockBuildLifecycle,
}));

const { mockExecute } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
}));
vi.mock('../../src/Scrapers/Pipeline/Index.js', () => ({
  execute: mockExecute,
}));

import { bootImporter, buildImporterBootHandle } from '../../src/Importer/ImporterBootstrap.js';

interface IFakeWiring {
  notificationService: unknown;
  pipeline: unknown;
  pipelineContext: unknown;
  isDryRun: boolean;
  hasProxy: boolean;
}

interface IFakeResilience {
  shutdownHandler: { onShutdown: ReturnType<typeof vi.fn> };
  errorFormatter: unknown;
}

interface IFakeLifecycle {
  shutdownApiGracefully: ReturnType<typeof vi.fn>;
  handleFatalError: ReturnType<typeof vi.fn>;
  handlePipelineFailure: ReturnType<typeof vi.fn>;
  safeShutdown: ReturnType<typeof vi.fn>;
}

function makeWiring(overrides: Partial<IFakeWiring> = {}): IFakeWiring {
  return {
    notificationService: { notify: vi.fn() },
    pipeline: { kind: 'fake-pipeline' },
    pipelineContext: { kind: 'fake-context' },
    isDryRun: false,
    hasProxy: false,
    ...overrides,
  };
}

function makeResilience(): IFakeResilience {
  return {
    shutdownHandler: { onShutdown: vi.fn() },
    errorFormatter: { format: vi.fn() },
  };
}

function makeLifecycle(overrides: Partial<IFakeLifecycle> = {}): IFakeLifecycle {
  return {
    shutdownApiGracefully: vi.fn(),
    handleFatalError: vi.fn(),
    handlePipelineFailure: vi.fn(),
    safeShutdown: vi.fn(),
    ...overrides,
  };
}

describe('ImporterBootstrap', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  const fakeConfig = { notifications: {}, logConfig: {} } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBootConfigAndLogger.mockReturnValue(fakeConfig);
    mockHandleValidateMode.mockResolvedValue(succeed({ status: 'skipped' }));
    mockBuildResilience.mockReturnValue(makeResilience());
    mockBuildImporter.mockReturnValue(makeWiring());
    mockBuildLifecycle.mockReturnValue(makeLifecycle());
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit:${String(code ?? 0)}`);
    }) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  describe('buildImporterBootHandle', () => {
    it('assembles config + resilience + wiring + lifecycle in dependency order', () => {
      const handle = buildImporterBootHandle();

      expect(handle.config).toBe(fakeConfig);
      expect(mockBootConfigAndLogger).toHaveBeenCalledTimes(1);
      expect(mockBuildResilience).toHaveBeenCalledTimes(1);
      expect(mockBuildImporter).toHaveBeenCalledWith(fakeConfig, handle.resilience, mockLogger);
      expect(mockBuildLifecycle).toHaveBeenCalledWith(
        expect.objectContaining({
          logger: mockLogger,
          notificationService: handle.wiring.notificationService,
          errorFormatter: handle.resilience.errorFormatter,
        })
      );
      expect(Object.isFrozen(handle)).toBe(true);
    });
  });

  describe('bootImporter', () => {
    it('exits 0 when pipeline succeeds with no explicit exit code', async () => {
      mockExecute.mockResolvedValue(succeed({ state: {} }));

      await expect(bootImporter()).rejects.toThrow('__exit:0');

      expect(mockHandleValidateMode).toHaveBeenCalledTimes(1);
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    it('forwards an explicit pipeline exit code to process.exit', async () => {
      mockExecute.mockResolvedValue(succeed({ state: { exitCode: 2 } }));

      await expect(bootImporter()).rejects.toThrow('__exit:2');
    });

    it('routes a pipeline Failure to lifecycle.handlePipelineFailure', async () => {
      const failure = fail('pipeline broke');
      mockExecute.mockResolvedValue(failure);
      const lifecycle = makeLifecycle({
        handlePipelineFailure: vi.fn(async () => {
          throw new Error('__exit:1');
        }),
      });
      mockBuildLifecycle.mockReturnValue(lifecycle);

      await expect(bootImporter()).rejects.toThrow('__exit:1');

      expect(lifecycle.handlePipelineFailure).toHaveBeenCalledWith(failure);
    });

    it('routes a thrown error to lifecycle.handleFatalError', async () => {
      const thrown = new Error('boom');
      mockExecute.mockRejectedValue(thrown);
      const lifecycle = makeLifecycle({
        handleFatalError: vi.fn(async () => {
          throw new Error('__exit:1');
        }),
      });
      mockBuildLifecycle.mockReturnValue(lifecycle);

      await expect(bootImporter()).rejects.toThrow('__exit:1');

      expect(lifecycle.handleFatalError).toHaveBeenCalledWith(thrown);
    });

    it('registers the lifecycle.shutdownApiGracefully callback on the shutdown handler', async () => {
      mockExecute.mockResolvedValue(succeed({ state: {} }));
      const resilience = makeResilience();
      const lifecycle = makeLifecycle();
      mockBuildResilience.mockReturnValue(resilience);
      mockBuildLifecycle.mockReturnValue(lifecycle);

      await expect(bootImporter()).rejects.toThrow('__exit:0');

      expect(resilience.shutdownHandler.onShutdown).toHaveBeenCalledWith(
        lifecycle.shutdownApiGracefully
      );
    });

    it('emits the dry-run banner when wiring reports isDryRun=true', async () => {
      mockExecute.mockResolvedValue(succeed({ state: {} }));
      mockBuildImporter.mockReturnValue(makeWiring({ isDryRun: true, hasProxy: true }));

      await expect(bootImporter()).rejects.toThrow('__exit:0');

      const banners = mockLogger.info.mock.calls.map((c) => c[0] as string);
      expect(banners.some((b) => b.includes('DRY RUN'))).toBe(true);
      expect(banners.some((b) => b.includes('proxy'))).toBe(true);
    });
  });
});
