import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { buildProcessLifecycle } from '../../src/Importer/ProcessLifecycle.js';
import type { IProcessLifecycleDeps, IShutdownableApi } from '../../src/Importer/ProcessLifecycle.js';
import { ErrorFormatter } from '../../src/Errors/ErrorFormatter.js';
import { isSuccess } from '../../src/Types/ProcedureHelpers.js';
import type NotificationService from '../../src/Services/NotificationService.js';

function makeLogger() {
  return { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeApi(opts: { failShutdown?: boolean } = {}): IShutdownableApi {
  return {
    shutdown: opts.failShutdown
      ? vi.fn().mockRejectedValue(new Error('api down'))
      : vi.fn().mockResolvedValue(undefined),
  };
}

function makeNotifier() {
  return {
    sendError: vi.fn().mockResolvedValue(undefined),
    sendSummary: vi.fn(),
    sendMessage: vi.fn(),
  } as unknown as NotificationService;
}

function makeDeps(overrides: Partial<IProcessLifecycleDeps> = {}): IProcessLifecycleDeps {
  return {
    logger: makeLogger(),
    notificationService: makeNotifier(),
    errorFormatter: new ErrorFormatter(),
    api: makeApi(),
    ...overrides,
  };
}

describe('ProcessLifecycle', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code as number})`);
    });
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  describe('safeShutdown', () => {
    it('returns api-shutdown on clean shutdown', async () => {
      const lc = buildProcessLifecycle(makeDeps());
      const result = await lc.safeShutdown();
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) expect(result.data.status).toBe('api-shutdown');
    });

    it('returns api-shutdown-error and logs when api.shutdown throws', async () => {
      const logger = makeLogger();
      const lc = buildProcessLifecycle(makeDeps({ logger, api: makeApi({ failShutdown: true }) }));
      const result = await lc.safeShutdown();
      expect(isSuccess(result)).toBe(true);
      if (isSuccess(result)) expect(result.data.status).toBe('api-shutdown-error');
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Error during API shutdown'));
    });
  });

  describe('shutdownApiGracefully', () => {
    it('logs the shutdown banner and returns the underlying safeShutdown result', async () => {
      const logger = makeLogger();
      const lc = buildProcessLifecycle(makeDeps({ logger }));
      const result = await lc.shutdownApiGracefully();
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Shutting down Actual Budget API'));
      expect(isSuccess(result)).toBe(true);
    });
  });

  describe('handleFatalError', () => {
    it('formats Error instances, logs stack, notifies, shuts down, exits 1', async () => {
      const logger = makeLogger();
      const notifier = makeNotifier();
      const lc = buildProcessLifecycle(makeDeps({ logger, notificationService: notifier }));
      const err = new Error('boom');

      await expect(lc.handleFatalError(err)).rejects.toThrow('process.exit(1)');

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('boom'));
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Stack trace'));
      expect(notifier.sendError).toHaveBeenCalledOnce();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('wraps non-Error throwables in a synthetic Error', async () => {
      const logger = makeLogger();
      const notifier = makeNotifier();
      const lc = buildProcessLifecycle(makeDeps({ logger, notificationService: notifier }));

      await expect(lc.handleFatalError('plain string failure')).rejects.toThrow('process.exit(1)');

      expect(notifier.sendError).toHaveBeenCalledOnce();
      expect(logger.error).not.toHaveBeenCalledWith(expect.stringContaining('Stack trace'));
    });
  });

  describe('handlePipelineFailure', () => {
    it('logs the pipeline failure, notifies, shuts down, exits 1', async () => {
      const logger = makeLogger();
      const notifier = makeNotifier();
      const lc = buildProcessLifecycle(makeDeps({ logger, notificationService: notifier }));

      await expect(
        lc.handlePipelineFailure({ message: 'all banks failed' }),
      ).rejects.toThrow('process.exit(1)');

      expect(logger.error).toHaveBeenCalledWith('Pipeline failed: all banks failed');
      expect(notifier.sendError).toHaveBeenCalledWith('all banks failed');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
