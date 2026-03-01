import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramCommandHandler } from '../../src/Services/TelegramCommandHandler.js';

const { mockGetRecent } = vi.hoisted(() => ({ mockGetRecent: vi.fn().mockReturnValue([]) }));

vi.mock('../../src/Logger/index.js', () => ({
  getLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  createLogger: vi.fn(),
  getLogBuffer: vi.fn().mockReturnValue({ isEnabled: () => false }),
  LogFileReader: vi.fn().mockImplementation(function() { return { getRecent: mockGetRecent }; }),
  deriveLogFormat: vi.fn().mockReturnValue('words'),
}));

describe('TelegramCommandHandler', () => {
  let handler: TelegramCommandHandler;
  let mockRunImport: any;
  let mockNotifier: any;

  beforeEach(() => {
    mockRunImport = vi.fn().mockResolvedValue(0);
    mockNotifier = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      sendSummary: vi.fn(),
      sendError: vi.fn()
    };
    handler = new TelegramCommandHandler({ runImport: mockRunImport, notifier: mockNotifier });
    vi.clearAllMocks();
    mockGetRecent.mockReturnValue([]);
  });

  it('runs import on /scan', async () => {
    await handler.handle('/scan');

    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Starting import'));
    expect(mockRunImport).toHaveBeenCalled();
  });

  it('runs import on /import', async () => {
    await handler.handle('/import');
    expect(mockRunImport).toHaveBeenCalled();
  });

  it('prevents concurrent imports', async () => {
    let resolveImport: any;
    mockRunImport.mockImplementation(() => new Promise(resolve => { resolveImport = resolve; }));

    const first = handler.handle('/scan');

    // Wait for first to start
    await new Promise(resolve => setTimeout(resolve, 10));

    // Try second while first is running
    await handler.handle('/scan');
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('already running'));

    resolveImport(0);
    await first;
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
    await handler.handle('/scan');
    await handler.handle('/status');

    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('ago'));
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('success'));
  });

  it('ignores unknown commands', async () => {
    await handler.handle('/unknown');
    expect(mockRunImport).not.toHaveBeenCalled();
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
    const mockRunWatch = vi.fn().mockResolvedValue('⚠️ Fast food: 120% of limit');
    const watchHandler = new TelegramCommandHandler({
      runImport: mockRunImport, notifier: mockNotifier, runWatch: mockRunWatch
    });
    await watchHandler.handle('/watch');
    expect(mockRunWatch).toHaveBeenCalled();
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(expect.stringContaining('Fast food'));
  });

  it('/watch with runWatch returning null shows default message', async () => {
    const mockRunWatch = vi.fn().mockResolvedValue(null);
    const watchHandler = new TelegramCommandHandler({
      runImport: mockRunImport, notifier: mockNotifier, runWatch: mockRunWatch
    });
    await watchHandler.handle('/watch');
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('All spending within limits')
    );
  });

  it('/watch with runWatch throwing shows error message', async () => {
    const mockRunWatch = vi.fn().mockRejectedValue(new Error('Timeout'));
    const watchHandler = new TelegramCommandHandler({
      runImport: mockRunImport, notifier: mockNotifier, runWatch: mockRunWatch
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
    const mockRunValidate = vi.fn().mockResolvedValue('All checks passed ✓');
    const validateHandler = new TelegramCommandHandler({
      runImport: mockRunImport, notifier: mockNotifier, runValidate: mockRunValidate,
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
      runImport: mockRunImport, notifier: mockNotifier, runValidate: mockRunValidate,
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

  it('/preview without runPreview shows unavailable message', async () => {
    await handler.handle('/preview');
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('unavailable')
    );
  });

  it('/preview starts dry run and sends completion', async () => {
    const mockRunPreview = vi.fn().mockResolvedValue(0);
    const previewHandler = new TelegramCommandHandler({
      runImport: mockRunImport, notifier: mockNotifier, runPreview: mockRunPreview,
    });
    await previewHandler.handle('/preview');
    expect(mockRunPreview).toHaveBeenCalled();
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('completed')
    );
  });

  it('/preview blocks when import already running', async () => {
    const mockRunPreview = vi.fn().mockResolvedValue(0);
    const previewHandler = new TelegramCommandHandler({
      runImport: mockRunImport, notifier: mockNotifier, runPreview: mockRunPreview,
    });
    (previewHandler as unknown as { importPromise: Promise<void> }).importPromise =
      new Promise(() => {});
    await previewHandler.handle('/preview');
    expect(mockRunPreview).not.toHaveBeenCalled();
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('already running')
    );
  });

  it('/preview sends error message when preview throws', async () => {
    const mockRunPreview = vi.fn().mockRejectedValue(new Error('scrape failed'));
    const previewHandler = new TelegramCommandHandler({
      runImport: mockRunImport, notifier: mockNotifier, runPreview: mockRunPreview,
    });
    await previewHandler.handle('/preview');
    expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('Preview error')
    );
  });

  // ─── buildErrorReply with auditLog (covers lines 91-99) ───

  it('/scan failure with audit log builds detailed error reply', async () => {
    const mockAuditLog = {
      record: vi.fn(),
      getRecent: vi.fn().mockReturnValue([{
        timestamp: '2026-02-28T14:30:00.000Z',
        totalBanks: 2, successfulBanks: 1, failedBanks: 1,
        totalTransactions: 3, totalDuplicates: 0,
        totalDuration: 5000, successRate: 50,
        banks: [{ name: 'discount', status: 'failed', error: 'Auth timeout' }],
      }]),
    };
    const auditHandler = new TelegramCommandHandler({
      runImport: vi.fn().mockResolvedValue(1),
      notifier: mockNotifier,
      auditLog: mockAuditLog,
    });
    await auditHandler.handle('/scan');
    const calls = mockNotifier.sendMessage.mock.calls.map((c: string[]) => c[0]);
    const errMsg = calls.find((m: string) => m.includes('Import failed'));
    expect(errMsg).toBeDefined();
    expect(errMsg).toContain('discount');
  });

  // ─── appendRecentHistory with entries (covers lines 116-117) ───

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
      runImport: mockRunImport, notifier: mockNotifier, auditLog: mockAuditLog,
    });
    await auditHandler.handle('/status');
    const msg = mockNotifier.sendMessage.mock.calls.at(-1)?.[0] as string;
    expect(msg).toContain('Recent imports');
    expect(msg).toContain('✅');
    expect(msg).toContain('⚠️');
  });

  // ─── timeSince direct branch coverage ───

  it('timeSince shows minutes (60-3599s)', async () => {
    const h = new TelegramCommandHandler({ runImport: mockRunImport, notifier: mockNotifier });
    (h as any).lastRunTime = new Date(Date.now() - 120_000); // 2 min ago
    (h as any).lastRunResult = 'success';
    await h.handle('/status');
    const msg = mockNotifier.sendMessage.mock.calls.at(-1)?.[0] as string;
    expect(msg).toMatch(/2m ago/);
  });

  it('timeSince shows hours (3600s+)', async () => {
    const h = new TelegramCommandHandler({ runImport: mockRunImport, notifier: mockNotifier });
    (h as any).lastRunTime = new Date(Date.now() - 7200_000); // 2 hours ago
    (h as any).lastRunResult = 'success';
    await h.handle('/status');
    const msg = mockNotifier.sendMessage.mock.calls.at(-1)?.[0] as string;
    expect(msg).toMatch(/2h ago/);
  });

  it('reply catch block is exercised when sendMessage throws', async () => {
    mockNotifier.sendMessage.mockRejectedValueOnce(new Error('Network'));
    await expect(handler.handle('/help')).resolves.not.toThrow();
  });
});
