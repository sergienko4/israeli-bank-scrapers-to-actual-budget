import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationService } from '../../src/services/NotificationService.js';
import { ImportSummary } from '../../src/services/MetricsService.js';

const mockSendSummary = vi.fn().mockResolvedValue(undefined);
const mockSendError = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/services/notifications/TelegramNotifier.js', () => ({
  TelegramNotifier: vi.fn().mockImplementation(function (this: any) {
    this.sendSummary = mockSendSummary;
    this.sendError = mockSendError;
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

describe('NotificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
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

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Notification failed')
    );
  });

  it('logs when telegram is enabled', () => {
    new NotificationService({
      enabled: true,
      telegram: { botToken: '123:ABC', chatId: '-100' }
    });

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Telegram notifications enabled'));
  });
});
