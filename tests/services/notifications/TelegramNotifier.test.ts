import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramNotifier } from '../../../src/services/notifications/TelegramNotifier.js';
import { ImportSummary } from '../../../src/services/MetricsService.js';

const mockSummary: ImportSummary = {
  totalBanks: 2,
  successfulBanks: 2,
  failedBanks: 0,
  totalTransactions: 15,
  totalDuplicates: 3,
  totalDuration: 8000,
  averageDuration: 4000,
  successRate: 100,
  banks: [
    {
      bankName: 'discount',
      startTime: 0,
      endTime: 5000,
      duration: 5000,
      status: 'success',
      transactionsImported: 10,
      transactionsSkipped: 2
    },
    {
      bankName: 'leumi',
      startTime: 0,
      endTime: 3000,
      duration: 3000,
      status: 'success',
      transactionsImported: 5,
      transactionsSkipped: 1
    }
  ]
};

const failedSummary: ImportSummary = {
  ...mockSummary,
  successfulBanks: 1,
  failedBanks: 1,
  successRate: 50,
  banks: [
    {
      bankName: 'discount',
      startTime: 0,
      endTime: 5000,
      duration: 5000,
      status: 'success',
      transactionsImported: 10,
      transactionsSkipped: 0
    },
    {
      bankName: 'leumi',
      startTime: 0,
      endTime: 3000,
      duration: 3000,
      status: 'failure',
      error: 'AuthenticationError',
      transactionsImported: 0,
      transactionsSkipped: 0
    }
  ]
};

describe('TelegramNotifier', () => {
  let notifier: TelegramNotifier;
  let fetchMock: any;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, text: vi.fn() });
    vi.stubGlobal('fetch', fetchMock);
    notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100' });
  });

  describe('sendSummary', () => {
    it('calls Telegram API with formatted message', async () => {
      await notifier.sendSummary(mockSummary);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.telegram.org/bot123:ABC/sendMessage');
      expect(options.method).toBe('POST');

      const body = JSON.parse(options.body);
      expect(body.chat_id).toBe('-100');
      expect(body.parse_mode).toBe('HTML');
      expect(body.text).toContain('Import Summary');
      expect(body.text).toContain('2/2 successful');
    });

    it('includes bank details in message', async () => {
      await notifier.sendSummary(mockSummary);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.text).toContain('discount');
      expect(body.text).toContain('leumi');
      expect(body.text).toContain('10 txns');
    });

    it('shows warning icon when banks fail', async () => {
      await notifier.sendSummary(failedSummary);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.text).toContain('⚠️');
      expect(body.text).toContain('AuthenticationError');
    });

    it('shows success icon when all banks succeed', async () => {
      await notifier.sendSummary(mockSummary);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.text).toContain('✅');
    });
  });

  describe('sendError', () => {
    it('sends error message', async () => {
      await notifier.sendError('Connection failed');

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.text).toContain('Import Failed');
      expect(body.text).toContain('Connection failed');
    });

    it('escapes HTML in error messages', async () => {
      await notifier.sendError('Error: <script>alert("xss")</script>');

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.text).toContain('&lt;script&gt;');
      expect(body.text).not.toContain('<script>');
    });
  });

  describe('error handling', () => {
    it('throws on API error response', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        text: vi.fn().mockResolvedValue('Unauthorized')
      });

      await expect(notifier.sendSummary(mockSummary))
        .rejects.toThrow('Telegram API error 401');
    });
  });
});
