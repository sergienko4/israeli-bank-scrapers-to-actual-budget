import { describe, it, expect, vi, beforeEach } from 'vitest';
import NotificationService from '../../src/Services/NotificationService.js';
import { IImportSummary } from '../../src/Services/MetricsService.js';
import * as LoggerModule from '../../src/Logger/Index.js';

const mockSendSummary = vi.fn().mockResolvedValue(undefined);
const mockSendError = vi.fn().mockResolvedValue(undefined);
const mockSendMessage = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/Services/Notifications/TelegramNotifier.js', () => ({
  default: vi.fn().mockImplementation(function (this: any) {
    this.sendSummary = mockSendSummary;
    this.sendError = mockSendError;
    this.sendMessage = mockSendMessage;
  })
}));

const mockSummary: IImportSummary = {
  totalBanks: 2,
  successfulBanks: 1,
  failedBanks: 1,
  totalTransactions: 10,
  totalDuplicates: 3,
  totalDuration: 5000,
  averageDuration: 2500,
  successRate: 50,
  banks: []
};

const mockLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('NotificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(LoggerModule, 'getLogger').mockReturnValue(mockLogger as any);
  });

  it('returns succeed with sent:0 when config is undefined', async () => {
    const service = new NotificationService(undefined);
    const summaryResult = await service.sendSummary(mockSummary);
    const errorResult = await service.sendError('test error');
    expect(summaryResult.success).toBe(true);
    if (summaryResult.success) expect(summaryResult.data.sent).toBe(0);
    expect(errorResult.success).toBe(true);
    if (errorResult.success) expect(errorResult.data.sent).toBe(0);
    expect(mockSendSummary).not.toHaveBeenCalled();
    expect(mockSendError).not.toHaveBeenCalled();
  });

  it('returns succeed with sent:0 when enabled is false', async () => {
    const service = new NotificationService({ enabled: false });
    const result = await service.sendSummary(mockSummary);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sent).toBe(0);
    expect(mockSendSummary).not.toHaveBeenCalled();
  });

  it('returns succeed with sent:0 when enabled but no channels configured', async () => {
    const service = new NotificationService({ enabled: true });
    const result = await service.sendSummary(mockSummary);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sent).toBe(0);
    expect(mockSendSummary).not.toHaveBeenCalled();
  });

  it('delegates sendSummary to telegram notifier and returns sent:1', async () => {
    const service = new NotificationService({
      enabled: true,
      telegram: { botToken: '123:ABC', chatId: '-100' }
    });

    const result = await service.sendSummary(mockSummary);
    expect(mockSendSummary).toHaveBeenCalledWith(mockSummary);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sent).toBe(1);
  });

  it('delegates sendError to telegram notifier and returns sent:1', async () => {
    const service = new NotificationService({
      enabled: true,
      telegram: { botToken: '123:ABC', chatId: '-100' }
    });

    const result = await service.sendError('Critical failure');
    expect(mockSendError).toHaveBeenCalledWith('Critical failure');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sent).toBe(1);
  });

  it('returns fail when all notifiers reject', async () => {
    mockSendSummary.mockRejectedValueOnce(new Error('Network error'));
    mockSendError.mockRejectedValueOnce(new Error('Network error'));

    const service = new NotificationService({
      enabled: true,
      telegram: { botToken: '123:ABC', chatId: '-100' }
    });

    const summaryResult = await service.sendSummary(mockSummary);
    const errorResult = await service.sendError('test');

    expect(summaryResult.success).toBe(false);
    if (!summaryResult.success) expect(summaryResult.message).toBe('all notifiers failed');
    expect(errorResult.success).toBe(false);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Notification failed')
    );
  });

  it('logs when telegram is enabled', () => {
    const _svc = new NotificationService({
      enabled: true,
      telegram: { botToken: '123:ABC', chatId: '-100' }
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Telegram notifications enabled')
    );
  });

  it('logs when webhook is enabled with explicit format', () => {
    const _svc = new NotificationService({
      enabled: true,
      webhook: { url: 'https://hooks.example.com/test', format: 'slack' }
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Webhook notifications enabled (slack)')
    );
  });

  it('logs webhook enabled with plain fallback when format is omitted', () => {
    const _svc = new NotificationService({
      enabled: true,
      webhook: { url: 'https://hooks.example.com/test' }
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Webhook notifications enabled (plain)')
    );
  });

  it('sendMessage delegates to telegram notifier and returns sent:1', async () => {
    const service = new NotificationService({
      enabled: true,
      telegram: { botToken: '123:ABC', chatId: '-100' }
    });
    const result = await service.sendMessage('hello world');
    expect(mockSendMessage).toHaveBeenCalledWith('hello world');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sent).toBe(1);
  });
});
