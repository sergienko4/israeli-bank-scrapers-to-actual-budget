import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramNotifier } from '../../../src/services/notifications/TelegramNotifier.js';
import { ImportSummary } from '../../../src/services/MetricsService.js';

const summaryWithTxns: ImportSummary = {
  totalBanks: 1,
  successfulBanks: 1,
  failedBanks: 0,
  totalTransactions: 2,
  totalDuplicates: 0,
  totalDuration: 5000,
  averageDuration: 5000,
  successRate: 100,
  banks: [{
    bankName: 'discount',
    startTime: 0, endTime: 5000, duration: 5000,
    status: 'success',
    transactionsImported: 2, transactionsSkipped: 0,
    reconciliationStatus: 'skipped',
    accounts: [{
      accountNumber: '0152228812',
      balance: 16242.97,
      currency: 'ILS',
      transactions: [
        { date: '2026-02-14', description: 'Transfer from account', amount: 1000 },
        { date: '2026-02-14', description: 'Amex charge', amount: -66211 }
      ]
    }]
  }]
};

const failedSummary: ImportSummary = {
  totalBanks: 2, successfulBanks: 1, failedBanks: 1,
  totalTransactions: 2, totalDuplicates: 0,
  totalDuration: 8000, averageDuration: 4000, successRate: 50,
  banks: [
    {
      bankName: 'discount', startTime: 0, endTime: 5000, duration: 5000,
      status: 'success', transactionsImported: 2, transactionsSkipped: 0, accounts: []
    },
    {
      bankName: 'leumi', startTime: 0, endTime: 3000, duration: 3000,
      status: 'failure', error: 'AuthenticationError',
      transactionsImported: 0, transactionsSkipped: 0, accounts: []
    }
  ]
};

function getText(fetchMock: any): string {
  return JSON.parse(fetchMock.mock.calls[0][1].body).text;
}

describe('TelegramNotifier', () => {
  let fetchMock: any;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, text: vi.fn() });
    vi.stubGlobal('fetch', fetchMock);
  });

  describe('API integration', () => {
    it('calls Telegram API with correct URL and headers', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100' });
      await notifier.sendSummary(summaryWithTxns);

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.telegram.org/bot123:ABC/sendMessage');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body).chat_id).toBe('-100');
      expect(JSON.parse(options.body).parse_mode).toBe('HTML');
    });

    it('throws on API error', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 401, text: vi.fn().mockResolvedValue('Unauthorized') });
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100' });
      await expect(notifier.sendSummary(summaryWithTxns)).rejects.toThrow('Telegram API error 401');
    });
  });

  describe('sendError', () => {
    it('sends formatted error', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100' });
      await notifier.sendError('Connection failed');
      expect(getText(fetchMock)).toContain('Import Failed');
      expect(getText(fetchMock)).toContain('Connection failed');
    });

    it('escapes HTML', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100' });
      await notifier.sendError('<script>xss</script>');
      expect(getText(fetchMock)).toContain('&lt;script&gt;');
    });
  });

  describe('format: summary (default)', () => {
    it('uses summary format when no messageFormat set', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100' });
      await notifier.sendSummary(summaryWithTxns);
      const text = getText(fetchMock);
      expect(text).toContain('Import Summary');
      expect(text).toContain('Transactions: 2 imported');
      expect(text).toContain('discount');
      expect(text).not.toContain('0152228812'); // No account details in summary
    });

    it('shows warning icon on failures', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100' });
      await notifier.sendSummary(failedSummary);
      expect(getText(fetchMock)).toContain('⚠️');
      expect(getText(fetchMock)).toContain('AuthenticationError');
    });
  });

  describe('format: compact', () => {
    it('shows transaction details with amounts', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: 'compact' });
      await notifier.sendSummary(summaryWithTxns);
      const text = getText(fetchMock);
      expect(text).toContain('0152228812');
      expect(text).toContain('Transfer from account');
      expect(text).toContain('+10.00');
      expect(text).toContain('-662.11');
      expect(text).toContain('Balance matched');
    });

    it('shows balance', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: 'compact' });
      await notifier.sendSummary(summaryWithTxns);
      expect(getText(fetchMock)).toContain('16,242.97');
    });
  });

  describe('format: ledger', () => {
    it('uses monospace code block', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: 'ledger' });
      await notifier.sendSummary(summaryWithTxns);
      const text = getText(fetchMock);
      expect(text).toContain('<code>');
      expect(text).toContain('</code>');
      expect(text).toContain('Transfer from acco');
      expect(text).toContain('+10.00');
    });

    it('truncates long descriptions', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: 'ledger' });
      const longSummary = {
        ...summaryWithTxns,
        banks: [{
          ...summaryWithTxns.banks[0],
          accounts: [{
            ...summaryWithTxns.banks[0].accounts[0],
            transactions: [
              { date: '2026-02-14', description: 'Very long transaction description that exceeds limit', amount: 1000 }
            ]
          }]
        }]
      };
      await notifier.sendSummary(longSummary);
      expect(getText(fetchMock)).toContain('..');
    });
  });

  describe('format: emoji', () => {
    it('uses deposit/payment icons', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: 'emoji' });
      await notifier.sendSummary(summaryWithTxns);
      const text = getText(fetchMock);
      expect(text).toContain('📥'); // deposit
      expect(text).toContain('📤'); // payment
      expect(text).toContain('💳');
      expect(text).toContain('💰');
    });

    it('shows balance with currency', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: 'emoji' });
      await notifier.sendSummary(summaryWithTxns);
      expect(getText(fetchMock)).toContain('16,242.97 ILS');
    });
  });

  describe('all formats handle failures', () => {
    for (const fmt of ['summary', 'compact', 'ledger', 'emoji'] as const) {
      it(`${fmt} format shows errors`, async () => {
        const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: fmt });
        await notifier.sendSummary(failedSummary);
        const text = getText(fetchMock);
        expect(text).toContain('AuthenticationError');
      });
    }
  });
});
