import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramCommandHandler } from '../../src/Services/TelegramCommandHandler.js';
import type { ImportMediator } from '../../src/Services/ImportMediator.js';

const { mockGetRecent } = vi.hoisted(() => ({ mockGetRecent: vi.fn().mockReturnValue([]) }));

vi.mock('../../src/Logger/Index.js', () => ({
  getLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  createLogger: vi.fn(),
  getLogBuffer: vi.fn().mockReturnValue({ isEnabled: () => false }),
  LogFileReader: vi.fn().mockImplementation(function() { return { getRecent: mockGetRecent }; }),
  deriveLogFormat: vi.fn().mockReturnValue('words'),
}));

/**
 * Creates a mock ImportMediator with default idle state.
 * @returns A mock ImportMediator for testing.
 */
function createMockMediator(): ImportMediator {
  return {
    isImporting: vi.fn().mockReturnValue(false),
    requestImport: vi.fn().mockReturnValue('batch-123'),
    getLastResult: vi.fn().mockReturnValue(null),
    getLastRunTime: vi.fn().mockReturnValue(null),
    waitForBatch: vi.fn().mockResolvedValue({ failureCount: 0 }),
    setPoller: vi.fn(),
  } as unknown as ImportMediator;
}

describe('TelegramCommandHandler', () => {
  let handler: TelegramCommandHandler;
  let mockMediator: ImportMediator;
  let mockNotifier: { sendMessage: ReturnType<typeof vi.fn>; sendSummary: ReturnType<typeof vi.fn>; sendError: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockMediator = createMockMediator();
    mockNotifier = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      sendSummary: vi.fn(),
      sendError: vi.fn()
    };
    handler = new TelegramCommandHandler({ mediator: mockMediator, notifier: mockNotifier });
    vi.clearAllMocks();
    mockGetRecent.mockReturnValue([]);
    // Re-setup defaults after clearAllMocks
    (mockMediator.isImporting as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (mockMediator.requestImport as ReturnType<typeof vi.fn>).mockReturnValue('batch-123');
    (mockMediator.getLastResult as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (mockMediator.getLastRunTime as ReturnType<typeof vi.fn>).mockReturnValue(null);
    mockNotifier.sendMessage.mockResolvedValue(undefined);
  });

  it('runs import on /scan', async () => {
    await handler.handle('/scan');

    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Starting import'));
    expect(mockMediator.requestImport).toHaveBeenCalledWith({ banks: undefined, source: 'telegram' });
  });

  it('runs import on /import', async () => {
    await handler.handle('/import');
    expect(mockMediator.requestImport).toHaveBeenCalledWith({ banks: undefined, source: 'telegram' });
  });

  it('/scan with single bank passes bank array to mediator', async () => {
    const mockGetBankNames = vi.fn().mockReturnValue(['discount', 'visaCal', 'oneZero']);
    handler = new TelegramCommandHandler({
      mediator: mockMediator, notifier: mockNotifier, getBankNames: mockGetBankNames,
    });

    await handler.handle('/scan discount');

    expect(mockMediator.requestImport).toHaveBeenCalledWith({
      banks: ['discount'], source: 'telegram',
    });
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('discount'));
  });

  it('/scan with multiple banks comma-separated', async () => {
    const mockGetBankNames = vi.fn().mockReturnValue(['discount', 'visaCal', 'oneZero']);
    handler = new TelegramCommandHandler({
      mediator: mockMediator, notifier: mockNotifier, getBankNames: mockGetBankNames,
    });

    await handler.handle('/scan visaCal,oneZero');

    expect(mockMediator.requestImport).toHaveBeenCalledWith({
      banks: ['visaCal', 'oneZero'], source: 'telegram',
    });
  });

  it('/scan with unknown bank replies error and lists available', async () => {
    const mockGetBankNames = vi.fn().mockReturnValue(['discount', 'visaCal']);
    handler = new TelegramCommandHandler({
      mediator: mockMediator, notifier: mockNotifier, getBankNames: mockGetBankNames,
    });

    await handler.handle('/scan unknownBank');

    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Unknown bank')
    );
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('discount')
    );
    expect(mockMediator.requestImport).not.toHaveBeenCalled();
  });

  it('/scan with empty bank list falls through to import', async () => {
    const mockGetBankNames = vi.fn().mockReturnValue([]);
    const mockSendMenu = vi.fn();
    handler = new TelegramCommandHandler({
      mediator: mockMediator, notifier: mockNotifier,
      getBankNames: mockGetBankNames, sendScanMenu: mockSendMenu,
    });

    await handler.handle('/scan');

    expect(mockSendMenu).not.toHaveBeenCalled();
    expect(mockMediator.requestImport).toHaveBeenCalled();
  });

  it('scan_all callback imports all banks (bypasses menu)', async () => {
    const mockGetBankNames = vi.fn().mockReturnValue(['discount', 'visaCal']);
    handler = new TelegramCommandHandler({
      mediator: mockMediator, notifier: mockNotifier,
      getBankNames: mockGetBankNames,
      sendScanMenu: vi.fn(),
    });

    await handler.handle('scan_all');

    expect(mockMediator.requestImport).toHaveBeenCalledWith({
      banks: undefined, source: 'telegram',
    });
  });

  it('scan:bankName callback imports that bank directly', async () => {
    const mockGetBankNames = vi.fn().mockReturnValue(['discount', 'visaCal']);
    handler = new TelegramCommandHandler({
      mediator: mockMediator, notifier: mockNotifier, getBankNames: mockGetBankNames,
    });

    await handler.handle('scan:discount');

    expect(mockMediator.requestImport).toHaveBeenCalledWith({
      banks: ['discount'], source: 'telegram',
    });
  });

  it('/scan bank name is case-insensitive', async () => {
    const mockGetBankNames = vi.fn().mockReturnValue(['beinleumi', 'oneZero']);
    handler = new TelegramCommandHandler({
      mediator: mockMediator, notifier: mockNotifier, getBankNames: mockGetBankNames,
    });

    await handler.handle('/scan BEINLEUMI');  // uppercase, config has lowercase

    expect(mockMediator.requestImport).toHaveBeenCalledWith({
      banks: ['beinleumi'], source: 'telegram',
    });
  });

  it('prevents concurrent imports on /scan', async () => {
    (mockMediator.isImporting as ReturnType<typeof vi.fn>).mockReturnValue(true);

    await handler.handle('/scan');
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('already running'));
    expect(mockMediator.requestImport).not.toHaveBeenCalled();
  });

  it('prevents concurrent imports on scan_all', async () => {
    (mockMediator.isImporting as ReturnType<typeof vi.fn>).mockReturnValue(true);

    await handler.handle('scan_all');
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('already running'));
    expect(mockMediator.requestImport).not.toHaveBeenCalled();
  });

  it('responds to /help', async () => {
    await handler.handle('/help');

    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Available Commands'));
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('/scan'));
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('/logs'));
  });

  it('responds to /start', async () => {
    await handler.handle('/start');
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Available Commands'));
  });

  it('responds to /status with no previous runs', async () => {
    await handler.handle('/status');
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('No imports run yet'));
  });

  it('responds to /status after a run', async () => {
    (mockMediator.getLastRunTime as ReturnType<typeof vi.fn>).mockReturnValue(new Date());
    (mockMediator.getLastResult as ReturnType<typeof vi.fn>).mockReturnValue({ failureCount: 0 });

    await handler.handle('/status');

    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('ago'));
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('success'));
  });

  it('ignores unknown commands', async () => {
    await handler.handle('/unknown');
    expect(mockMediator.requestImport).not.toHaveBeenCalled();
  });

  it('/watch without runWatch shows hint message', async () => {
    await handler.handle('/watch');
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Spending watch')
    );
  });

  // ─── /logs command tests ───

  it('/logs shows empty message when no entries', async () => {
    mockGetRecent.mockReturnValue([]);
    await handler.handle('/logs');
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('No log entries'));
  });

  it('/logs shows recent entries from file', async () => {
    mockGetRecent.mockReturnValue(['line 1', 'line 2']);
    await handler.handle('/logs');
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('line 1'));
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('line 2'));
  });

  it('/logs with count parameter passes count to reader', async () => {
    mockGetRecent.mockReturnValue(['entry 8', 'entry 9', 'entry 10']);
    await handler.handle('/logs 3');
    const msg = mockNotifier.sendMessage.mock.calls.at(-1)?.[0] as string;
    expect(msg).toContain('entry 8');
    expect(msg).toContain('entry 9');
    expect(msg).toContain('entry 10');
    expect(mockGetRecent).toHaveBeenCalledWith(3);
  });

  it('/logs caps count at 150', async () => {
    mockGetRecent.mockReturnValue(['test']);
    await handler.handle('/logs 9999');
    expect(mockGetRecent).toHaveBeenCalledWith(150);
  });

  it('/logs handles non-numeric arg gracefully', async () => {
    mockGetRecent.mockReturnValue(['test']);
    await handler.handle('/logs abc');
    expect(mockGetRecent).toHaveBeenCalledWith(50); // DEFAULT_LOG_COUNT
  });

  it('/logs wraps output in pre tags', async () => {
    mockGetRecent.mockReturnValue(['formatted line']);
    await handler.handle('/logs');
    const msg = mockNotifier.sendMessage.mock.calls.at(-1)?.[0] as string;
    expect(msg).toContain('<pre>');
    expect(msg).toContain('</pre>');
  });

  it('/logs truncates long output to fit Telegram limit', async () => {
    mockGetRecent.mockReturnValue(Array.from({ length: 100 }, () => 'x'.repeat(100)));
    await handler.handle('/logs');
    const msg = mockNotifier.sendMessage.mock.calls.at(-1)?.[0] as string;
    expect(msg.length).toBeLessThanOrEqual(4096);
    expect(msg).toContain('...(earlier entries omitted)');
  });

  it('/logs does not truncate short output', async () => {
    mockGetRecent.mockReturnValue(['short']);
    await handler.handle('/logs');
    const msg = mockNotifier.sendMessage.mock.calls.at(-1)?.[0] as string;
    expect(msg).not.toContain('truncated');
  });

  // ─── /watch with runWatch provided ───

  it('/watch with runWatch: calls it and shows result', async () => {
    const mockRunWatch = vi.fn().mockResolvedValue('\u26a0\ufe0f Fast food: 120% of limit');
    const watchHandler = new TelegramCommandHandler({
      mediator: mockMediator, notifier: mockNotifier, runWatch: mockRunWatch
    });
    await watchHandler.handle('/watch');
    expect(mockRunWatch).toHaveBeenCalled();
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Fast food'));
  });

  it('/watch with runWatch returning null shows default message', async () => {
    const mockRunWatch = vi.fn().mockResolvedValue(null);
    const watchHandler = new TelegramCommandHandler({
      mediator: mockMediator, notifier: mockNotifier, runWatch: mockRunWatch
    });
    await watchHandler.handle('/watch');
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('All spending within limits')
    );
  });

  it('/watch with runWatch throwing shows error message', async () => {
    const mockRunWatch = vi.fn().mockRejectedValue(new Error('Timeout'));
    const watchHandler = new TelegramCommandHandler({
      mediator: mockMediator, notifier: mockNotifier, runWatch: mockRunWatch
    });
    await watchHandler.handle('/watch');
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Watch error'));
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Timeout'));
  });

  // ─── /check_config ───

  it('/check_config without runValidate shows unavailable message', async () => {
    await handler.handle('/check_config');
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('unavailable')
    );
  });

  it('/check_config with runValidate calls it and sends report in <pre> block', async () => {
    const mockRunValidate = vi.fn().mockResolvedValue('All checks passed \u2713');
    const validateHandler = new TelegramCommandHandler({
      mediator: mockMediator, notifier: mockNotifier, runValidate: mockRunValidate,
    });
    await validateHandler.handle('/check_config');
    expect(mockRunValidate).toHaveBeenCalled();
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('All checks passed')
    );
  });

  it('/check_config with runValidate throwing shows error message', async () => {
    const mockRunValidate = vi.fn().mockRejectedValue(new Error('load failed'));
    const validateHandler = new TelegramCommandHandler({
      mediator: mockMediator, notifier: mockNotifier, runValidate: mockRunValidate,
    });
    await validateHandler.handle('/check_config');
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Validation error')
    );
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('load failed')
    );
  });

  // ─── /preview ───

  it('/preview requests dry run via mediator', async () => {
    await handler.handle('/preview');
    expect(mockMediator.requestImport).toHaveBeenCalledWith({
      source: 'telegram', extraEnv: { DRY_RUN: 'true' },
    });
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('dry run')
    );
  });

  it('/preview blocks when import already running', async () => {
    (mockMediator.isImporting as ReturnType<typeof vi.fn>).mockReturnValue(true);
    await handler.handle('/preview');
    expect(mockMediator.requestImport).not.toHaveBeenCalled();
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('already running')
    );
  });

  // ─── appendRecentHistory with entries ───

  it('/status with audit entries calls formatAuditEntry for each', async () => {
    const mockAuditLog = {
      record: vi.fn(),
      getRecent: vi.fn().mockReturnValue([{
        timestamp: '2026-02-28T14:30:00.000Z',
        totalBanks: 1, successfulBanks: 1, failedBanks: 0,
        totalTransactions: 5, totalDuplicates: 0,
        totalDuration: 3000, successRate: 100, banks: [],
      }, {
        timestamp: '2026-02-27T10:00:00.000Z',
        totalBanks: 1, successfulBanks: 0, failedBanks: 1,
        totalTransactions: 0, totalDuplicates: 0,
        totalDuration: 1000, successRate: 0, banks: [],
      }]),
    };
    const auditHandler = new TelegramCommandHandler({
      mediator: mockMediator, notifier: mockNotifier, auditLog: mockAuditLog,
    });
    await auditHandler.handle('/status');
    const msg = mockNotifier.sendMessage.mock.calls.at(-1)?.[0] as string;
    expect(msg).toContain('Recent imports');
  });

  // ─── timeSince direct branch coverage ───

  it('timeSince shows minutes (60-3599s)', async () => {
    (mockMediator.getLastRunTime as ReturnType<typeof vi.fn>).mockReturnValue(
      new Date(Date.now() - 120_000)
    );
    (mockMediator.getLastResult as ReturnType<typeof vi.fn>).mockReturnValue({ failureCount: 0 });
    await handler.handle('/status');
    const msg = mockNotifier.sendMessage.mock.calls.at(-1)?.[0] as string;
    expect(msg).toMatch(/2m ago/);
  });

  it('timeSince shows hours (3600s+)', async () => {
    (mockMediator.getLastRunTime as ReturnType<typeof vi.fn>).mockReturnValue(
      new Date(Date.now() - 7200_000)
    );
    (mockMediator.getLastResult as ReturnType<typeof vi.fn>).mockReturnValue({ failureCount: 0 });
    await handler.handle('/status');
    const msg = mockNotifier.sendMessage.mock.calls.at(-1)?.[0] as string;
    expect(msg).toMatch(/2h ago/);
  });

  it('reply catch block is exercised when sendMessage throws', async () => {
    mockNotifier.sendMessage.mockRejectedValueOnce(new Error('Network'));
    await expect(handler.handle('/help')).resolves.not.toThrow();
  });
});
