import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationService } from '../../src/Services/NotificationService.js';
import { ImportSummary } from '../../src/Services/MetricsService.js';
import * as LoggerModule from '../../src/Logger/Index.js';

const mockSendSummary = vi.fn().mockResolvedValue(undefined);
const mockSendError = vi.fn().mockResolvedValue(undefined);
const mockSendMessage = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/Services/Notifications/TelegramNotifier.js', () => ({
  TelegramNotifier: vi.fn().mockImplementation(function (this: any) {
    this.sendSummary = mockSendSummary;
    this.sendError = mockSendError;
    this.sendMessage = mockSendMessage;
  })
}));

const mockSummary: ImportSummary = {
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

  it('does nothing when config is undefined', async () => {
    const service = new NotificationService(undefined);
    await service.sendSummary(mockSummary);
    await service.sendError('test error');
    expect(mockSendSummary).not.toHaveBeenCalled();
    expect(mockSendError).not.toHaveBeenCalled();
  });

  it('does nothing when enabled is false', async () => {
    const service = new NotificationService({ enabled: false });
    await service.sendSummary(mockSummary);
    expect(mockSendSummary).not.toHaveBeenCalled();
  });

  it('does nothing when enabled but no channels configured', async () => {
    const service = new NotificationService({ enabled: true });
    await service.sendSummary(mockSummary);
    expect(mockSendSummary).not.toHaveBeenCalled();
  });

  it('delegates sendSummary to telegram notifier', async () => {
    const service = new NotificationService({
      enabled: true,
      telegram: { botToken: '123:ABC', chatId: '-100' }
    });

    await service.sendSummary(mockSummary);
    expect(mockSendSummary).toHaveBeenCalledWith(mockSummary);
  });

  it('delegates sendError to telegram notifier', async () => {
    const service = new NotificationService({
      enabled: true,
      telegram: { botToken: '123:ABC', chatId: '-100' }
    });

    await service.sendError('Critical failure');
    expect(mockSendError).toHaveBeenCalledWith('Critical failure');
  });

  it('catches notifier errors without throwing', async () => {
    mockSendSummary.mockRejectedValueOnce(new Error('Network error'));
    mockSendError.mockRejectedValueOnce(new Error('Network error'));

    const service = new NotificationService({
      enabled: true,
      telegram: { botToken: '123:ABC', chatId: '-100' }
    });

    await service.sendSummary(mockSummary);
    await service.sendError('test');

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

  it('sendMessage delegates to telegram notifier', async () => {
    const service = new NotificationService({
      enabled: true,
      telegram: { botToken: '123:ABC', chatId: '-100' }
    });
    await service.sendMessage('hello world');
    expect(mockSendMessage).toHaveBeenCalledWith('hello world');
  });
});
