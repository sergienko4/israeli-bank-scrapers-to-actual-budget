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
      newTransactions: [
        { date: '2026-02-14', description: 'Transfer from account', amount: 1000 },
        { date: '2026-02-14', description: 'Amex charge', amount: -66211 }
      ],
      existingTransactions: []
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
            newTransactions: [
              { date: '2026-02-14', description: 'Very long transaction description that exceeds limit', amount: 1000 }
            ],
            existingTransactions: []
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

  describe('maxTransactions', () => {
    it('defaults to 5 transactions per account', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: 'compact' });
      const txns = Array.from({ length: 10 }, (_, i) => ({
        date: '2026-02-14', description: `Txn ${i + 1}`, amount: -(i + 1) * 100
      }));
      const summary = { ...summaryWithTxns, banks: [{ ...summaryWithTxns.banks[0], accounts: [{ ...summaryWithTxns.banks[0].accounts[0], newTransactions: txns, existingTransactions: [] }] }] };
      await notifier.sendSummary(summary);
      const text = getText(fetchMock);
      expect(text).toContain('Txn 5');
      expect(text).not.toContain('Txn 6');
    });

    it('respects custom maxTransactions value', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: 'compact' }, 3);
      const txns = Array.from({ length: 10 }, (_, i) => ({
        date: '2026-02-14', description: `Txn ${i + 1}`, amount: -(i + 1) * 100
      }));
      const summary = { ...summaryWithTxns, banks: [{ ...summaryWithTxns.banks[0], accounts: [{ ...summaryWithTxns.banks[0].accounts[0], newTransactions: txns, existingTransactions: [] }] }] };
      await notifier.sendSummary(summary);
      const text = getText(fetchMock);
      expect(text).toContain('Txn 3');
      expect(text).not.toContain('Txn 4');
    });

    it('clamps to 25 maximum', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: 'compact' }, 50);
      const txns = Array.from({ length: 30 }, (_, i) => ({
        date: '2026-02-14', description: `Txn ${i + 1}`, amount: -(i + 1) * 100
      }));
      const summary = { ...summaryWithTxns, banks: [{ ...summaryWithTxns.banks[0], accounts: [{ ...summaryWithTxns.banks[0].accounts[0], newTransactions: txns, existingTransactions: [] }] }] };
      await notifier.sendSummary(summary);
      const text = getText(fetchMock);
      expect(text).toContain('Txn 25');
      expect(text).not.toContain('Txn 26');
    });
  });

  describe('truncation with HTML tags', () => {
    function buildLongSummary(accountCount: number): ImportSummary {
      const txns = Array.from({ length: 25 }, (_, i) => ({
        date: '2026-02-14', description: `Transaction number ${i + 1} with long details here`, amount: -(i + 1) * 100
      }));
      const accounts = Array.from({ length: accountCount }, (_, i) => ({
        ...summaryWithTxns.banks[0].accounts[0], accountNumber: `account-${i}`, newTransactions: txns, existingTransactions: []
      }));
      return {
        ...summaryWithTxns,
        banks: [{ ...summaryWithTxns.banks[0], accounts }]
      };
    }

    it('short message is not truncated', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: 'ledger' });
      await notifier.sendSummary(summaryWithTxns);
      expect(getText(fetchMock)).not.toContain('truncated');
    });

    it('ledger: closes unclosed <code> tag after truncation', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: 'ledger' }, 25);
      await notifier.sendSummary(buildLongSummary(5));
      const text = getText(fetchMock);
      expect(text).toContain('(truncated)');
      expect(text.length).toBeLessThanOrEqual(4096);
      const codeOpens = (text.match(/<code>/g) || []).length;
      const codeCloses = (text.match(/<\/code>/g) || []).length;
      expect(codeCloses).toBe(codeOpens);
    });

    it('compact: closes unclosed <b> tag after truncation', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: 'compact' }, 25);
      await notifier.sendSummary(buildLongSummary(5));
      const text = getText(fetchMock);
      expect(text).toContain('(truncated)');
      expect(text.length).toBeLessThanOrEqual(4096);
      const bOpens = (text.match(/<b>/g) || []).length;
      const bCloses = (text.match(/<\/b>/g) || []).length;
      expect(bCloses).toBe(bOpens);
    });

    it('emoji: closes tags after truncation', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: 'emoji' }, 25);
      await notifier.sendSummary(buildLongSummary(5));
      const text = getText(fetchMock);
      expect(text).toContain('(truncated)');
      expect(text.length).toBeLessThanOrEqual(4096);
      const bOpens = (text.match(/<b>/g) || []).length;
      const bCloses = (text.match(/<\/b>/g) || []).length;
      expect(bCloses).toBe(bOpens);
    });

    it('no partial HTML tags at cut point', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: 'ledger' }, 25);
      await notifier.sendSummary(buildLongSummary(5));
      const text = getText(fetchMock);
      // No unclosed < without matching >
      const lastOpen = text.lastIndexOf('<');
      const lastClose = text.lastIndexOf('>');
      expect(lastClose).toBeGreaterThanOrEqual(lastOpen);
    });

    it('summary format truncates without HTML issues', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: 'summary' });
      const longSummary = buildLongSummary(200);
      longSummary.banks = Array.from({ length: 50 }, (_, i) => ({
        ...summaryWithTxns.banks[0], bankName: `bank-${i}`
      }));
      await notifier.sendSummary(longSummary);
      const text = getText(fetchMock);
      if (text.includes('truncated')) {
        const bOpens = (text.match(/<b>/g) || []).length;
        const bCloses = (text.match(/<\/b>/g) || []).length;
        expect(bCloses).toBe(bOpens);
      }
    });
  });

  describe('registerCommands', () => {
    it('registers base commands via setMyCommands API', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100' });
      await notifier.registerCommands();
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.telegram.org/bot123:ABC/setMyCommands',
        expect.objectContaining({ method: 'POST' })
      );
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.commands).toHaveLength(4);
      expect(body.commands.map((c: { command: string }) => c.command)).toEqual(['scan', 'status', 'logs', 'help']);
    });

    it('includes extra commands when provided', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100' });
      await notifier.registerCommands([{ command: 'watch', description: 'Check spending' }]);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.commands).toHaveLength(5);
      expect(body.commands[2].command).toBe('watch');
    });

    it('filters out invalid commands (uppercase, too long)', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100' });
      await notifier.registerCommands([
        { command: 'INVALID', description: 'uppercase' },
        { command: 'a'.repeat(33), description: 'too long command' },
        { command: 'valid_cmd', description: 'ok' }
      ]);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      const names = body.commands.map((c: { command: string }) => c.command);
      expect(names).toContain('valid_cmd');
      expect(names).not.toContain('INVALID');
    });

    it('throws on API error', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 400, text: vi.fn().mockResolvedValue('Bad Request') });
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100' });
      await expect(notifier.registerCommands()).rejects.toThrow('setMyCommands failed');
    });
  });
});
