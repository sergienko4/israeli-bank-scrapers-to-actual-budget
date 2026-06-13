import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fail, succeed } from '../../src/Types/ProcedureHelpers.js';

const { mockCreateLogger, mockDeriveLogFormat } = vi.hoisted(() => ({
  mockCreateLogger: vi.fn(),
  mockDeriveLogFormat: vi.fn(() => 'words' as const),
}));
vi.mock('../../src/Logger/Index.js', () => ({
  createLogger: mockCreateLogger,
  deriveLogFormat: mockDeriveLogFormat,
  getLogger: vi.fn(),
  getLogBuffer: vi.fn(),
}));

const { mockLoad, MockConfigLoader } = vi.hoisted(() => {
  const load = vi.fn();
  class FakeConfigLoader {
    public load = load;
  }
  return { mockLoad: load, MockConfigLoader: FakeConfigLoader };
});
vi.mock('../../src/Config/ConfigLoader.js', () => ({
  ConfigLoader: MockConfigLoader,
}));

const { mockRunValidateMode } = vi.hoisted(() => ({
  mockRunValidateMode: vi.fn(),
}));
vi.mock('../../src/Config/ConfigValidator.js', () => ({
  runValidateMode: mockRunValidateMode,
}));

import { bootConfigAndLogger, handleValidateMode } from '../../src/Importer/ConfigBootstrap.js';

interface IFakeImporterConfig {
  notifications?: { telegram?: { messageFormat?: string; listenForCommands?: boolean } };
  logConfig?: { format?: string; logDir?: string };
}

function makeConfig(overrides: IFakeImporterConfig = {}): IFakeImporterConfig {
  return { notifications: {}, logConfig: {}, ...overrides };
}

describe('ConfigBootstrap', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let originalArgv: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    originalArgv = process.argv;
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit:${String(code ?? 0)}`);
    }) as never);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.argv = originalArgv;
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  describe('handleValidateMode', () => {
    it('returns skipped status when --validate is absent', async () => {
      process.argv = ['node', 'index.js'];

      const result = await handleValidateMode();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('skipped');
      }
      expect(mockRunValidateMode).not.toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('invokes validator and exits with its code when --validate is present', async () => {
      process.argv = ['node', 'index.js', '--validate'];
      mockRunValidateMode.mockResolvedValue(0);

      await expect(handleValidateMode()).rejects.toThrow('__exit:0');

      expect(mockRunValidateMode).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('forwards a non-zero validator exit code', async () => {
      process.argv = ['node', 'index.js', '--validate'];
      mockRunValidateMode.mockResolvedValue(1);

      await expect(handleValidateMode()).rejects.toThrow('__exit:1');
    });
  });

  describe('bootConfigAndLogger', () => {
    it('returns config and initialises logger on successful load', () => {
      const config = makeConfig({
        notifications: { telegram: { messageFormat: 'markdown', listenForCommands: false } },
      });
      mockLoad.mockReturnValue(succeed(config));

      const result = bootConfigAndLogger();

      expect(result).toBe(config);
      expect(mockDeriveLogFormat).toHaveBeenCalledWith('markdown', false);
      expect(mockCreateLogger).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'words', logDir: './logs' })
      );
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('writes fatal to stderr and exits 1 when ConfigLoader.load fails', () => {
      mockLoad.mockReturnValue(fail('bad config: missing field'));

      expect(() => bootConfigAndLogger()).toThrow('__exit:1');

      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Fatal: bad config'));
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mockCreateLogger).not.toHaveBeenCalled();
    });

    it('respects an explicit config.logConfig.format over the derived one', () => {
      const config = makeConfig({ logConfig: { format: 'json', logDir: '/var/log/app' } });
      mockLoad.mockReturnValue(succeed(config));

      bootConfigAndLogger();

      expect(mockCreateLogger).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'json', logDir: '/var/log/app' })
      );
    });

    it('handles missing notifications.telegram (undefined telegram block)', () => {
      const config = makeConfig({ notifications: {} });
      mockLoad.mockReturnValue(succeed(config));

      bootConfigAndLogger();

      expect(mockDeriveLogFormat).toHaveBeenCalledWith(undefined, undefined);
    });
  });
});
