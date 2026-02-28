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

    it('bank with duration 0 shows no duration suffix', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100' });
      const noDurSummary = { ...summaryWithTxns, banks: [{ ...summaryWithTxns.banks[0], duration: 0 }] };
      await notifier.sendSummary(noDurSummary);
      expect(getText(fetchMock)).toContain('discount');
    });

    it('shows warning icon on failures', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100' });
      await notifier.sendSummary(failedSummary);
      expect(getText(fetchMock)).toContain('⚠️');
      expect(getText(fetchMock)).toContain('AuthenticationError');
    });

    it('handles summary with no banks (empty banks array)', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100' });
      const emptySummary = { ...summaryWithTxns, banks: [] };
      await notifier.sendSummary(emptySummary);
      const text = getText(fetchMock);
      expect(text).toContain('Import Summary');
      expect(text).not.toContain('discount');
    });

    it('falls back to summary format for unknown messageFormat', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: 'bogus' as never });
      await notifier.sendSummary(summaryWithTxns);
      expect(getText(fetchMock)).toContain('Import Summary');
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

  describe('bank name HTML escaping', () => {
    const specialCharSummary: ImportSummary = {
      ...summaryWithTxns,
      banks: [{
        ...summaryWithTxns.banks[0],
        bankName: 'Bank <Test> & "Co"',
      }]
    };

    for (const fmt of ['summary', 'compact', 'ledger', 'emoji'] as const) {
      it(`${fmt}: escapes special chars in bank name`, async () => {
        const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: fmt });
        await notifier.sendSummary(specialCharSummary);
        const text = getText(fetchMock);
        expect(text).not.toContain('<Test>');
        expect(text).not.toContain('& "');
        expect(text).toContain('&lt;Test&gt;');
        expect(text).toContain('&amp;');
      });
    }
  });

  describe('accountName display', () => {
    const namedAccountSummary: ImportSummary = {
      ...summaryWithTxns,
      banks: [{
        ...summaryWithTxns.banks[0],
        accounts: [{ ...summaryWithTxns.banks[0].accounts[0], accountName: 'Savings Account' }]
      }]
    };

    for (const fmt of ['compact', 'ledger', 'emoji'] as const) {
      it(`${fmt}: shows accountName instead of accountNumber`, async () => {
        const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: fmt });
        await notifier.sendSummary(namedAccountSummary);
        const text = getText(fetchMock);
        expect(text).toContain('Savings Account');
        expect(text).not.toContain('0152228812');
      });

      it(`${fmt}: falls back to accountNumber when accountName is absent`, async () => {
        const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: fmt });
        await notifier.sendSummary(summaryWithTxns);
        expect(getText(fetchMock)).toContain('0152228812');
      });
    }

    it('accountName is HTML-escaped', async () => {
      const notifier = new TelegramNotifier({
        botToken: '123:ABC', chatId: '-100', messageFormat: 'compact'
      });
      const specialSummary = {
        ...summaryWithTxns,
        banks: [{
          ...summaryWithTxns.banks[0],
          accounts: [{ ...summaryWithTxns.banks[0].accounts[0], accountName: 'Savings & <Main>' }]
        }]
      };
      await notifier.sendSummary(specialSummary);
      const text = getText(fetchMock);
      expect(text).not.toContain('<Main>');
      expect(text).toContain('&amp;');
      expect(text).toContain('&lt;Main&gt;');
    });
  });

  describe('sendMessage', () => {
    it('delivers text directly', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100' });
      await notifier.sendMessage('Hello World');
      expect(getText(fetchMock)).toBe('Hello World');
    });
  });

  describe('showTransactions modes', () => {
    it("none: hides all transactions", async () => {
      const notifier = new TelegramNotifier(
        { botToken: '123:ABC', chatId: '-100', messageFormat: 'compact', showTransactions: 'none' }
      );
      await notifier.sendSummary(summaryWithTxns);
      const text = getText(fetchMock);
      expect(text).not.toContain('Transfer from account');
      expect(text).not.toContain('Amex charge');
    });

    it("all: includes existing transactions alongside new ones", async () => {
      const notifier = new TelegramNotifier(
        { botToken: '123:ABC', chatId: '-100', messageFormat: 'compact', showTransactions: 'all' }
      );
      const summary = {
        ...summaryWithTxns,
        banks: [{
          ...summaryWithTxns.banks[0],
          accounts: [{
            ...summaryWithTxns.banks[0].accounts[0],
            existingTransactions: [{ date: '2026-01-01', description: 'Old charge', amount: 500 }]
          }]
        }]
      };
      await notifier.sendSummary(summary);
      expect(getText(fetchMock)).toContain('Old charge');
    });
  });

  describe('reconciliationStatus', () => {
    it("created: shows + prefix for positive reconciliation amount", async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: 'compact' });
      const summary = {
        ...summaryWithTxns,
        banks: [{ ...summaryWithTxns.banks[0], reconciliationStatus: 'created' as const, reconciliationAmount: 5000 }]
      };
      await notifier.sendSummary(summary);
      expect(getText(fetchMock)).toContain('Reconciled: +50.00 ILS');
    });

    it("created: shows no prefix for negative reconciliation amount", async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: 'compact' });
      const summary = {
        ...summaryWithTxns,
        banks: [{ ...summaryWithTxns.banks[0], reconciliationStatus: 'created' as const, reconciliationAmount: -3000 }]
      };
      await notifier.sendSummary(summary);
      expect(getText(fetchMock)).toContain('Reconciled: -30.00 ILS');
    });

    it("already-reconciled: shows 'Already reconciled'", async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: 'compact' });
      const summary = {
        ...summaryWithTxns,
        banks: [{ ...summaryWithTxns.banks[0], reconciliationStatus: 'already-reconciled' as const }]
      };
      await notifier.sendSummary(summary);
      expect(getText(fetchMock)).toContain('Already reconciled');
    });
  });

  describe('account without balance', () => {
    const noBalanceSummary = {
      ...summaryWithTxns,
      banks: [{
        ...summaryWithTxns.banks[0],
        accounts: [{ ...summaryWithTxns.banks[0].accounts[0], balance: undefined, currency: undefined }]
      }]
    };

    it('compact: omits balance line when balance is undefined', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: 'compact' });
      await notifier.sendSummary(noBalanceSummary);
      expect(getText(fetchMock)).not.toContain('💰');
    });

    it('ledger: omits balance line when balance is undefined', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: 'ledger' });
      await notifier.sendSummary(noBalanceSummary);
      expect(getText(fetchMock)).not.toContain('💰');
    });

    it('emoji: omits balance line when balance is undefined', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: 'emoji' });
      await notifier.sendSummary(noBalanceSummary);
      expect(getText(fetchMock)).not.toContain('💰');
    });
  });

  describe('bank with undefined accounts', () => {
    it('ledger: handles bank where accounts is undefined', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: 'ledger' });
      const summary = {
        ...summaryWithTxns,
        banks: [{ ...summaryWithTxns.banks[0], accounts: undefined as never }]
      };
      await notifier.sendSummary(summary);
      expect(getText(fetchMock)).toContain('Import Summary');
    });

    it('emoji: handles bank where accounts is undefined', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: 'emoji' });
      const summary = {
        ...summaryWithTxns,
        banks: [{ ...summaryWithTxns.banks[0], accounts: undefined as never }]
      };
      await notifier.sendSummary(summary);
      expect(getText(fetchMock)).toContain('Import Summary');
    });

    it('compact: handles bank where accounts is undefined', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: 'compact' });
      const summary = {
        ...summaryWithTxns,
        banks: [{ ...summaryWithTxns.banks[0], accounts: undefined as never }]
      };
      await notifier.sendSummary(summary);
      expect(getText(fetchMock)).toContain('Import Summary');
    });

    it('ledger: showTransactions none produces no code block', async () => {
      const notifier = new TelegramNotifier(
        { botToken: '123:ABC', chatId: '-100', messageFormat: 'ledger', showTransactions: 'none' }
      );
      await notifier.sendSummary(summaryWithTxns);
      expect(getText(fetchMock)).not.toContain('<code>');
    });
  });

  describe('emoji format with duplicates and missing currency', () => {
    it('shows dup count when totalDuplicates > 0', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: 'emoji' });
      const dupSummary = { ...summaryWithTxns, totalDuplicates: 3 };
      await notifier.sendSummary(dupSummary);
      expect(getText(fetchMock)).toContain('3 dup');
    });

    it('shows ILS when account currency is undefined', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: 'emoji' });
      const noCurrencySummary = {
        ...summaryWithTxns,
        banks: [{
          ...summaryWithTxns.banks[0],
          accounts: [{ ...summaryWithTxns.banks[0].accounts[0], currency: undefined }]
        }]
      };
      await notifier.sendSummary(noCurrencySummary);
      expect(getText(fetchMock)).toContain('ILS');
    });

    it('compact: shows ILS when account currency is undefined', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100', messageFormat: 'compact' });
      const noCurrencySummary = {
        ...summaryWithTxns,
        banks: [{
          ...summaryWithTxns.banks[0],
          accounts: [{ ...summaryWithTxns.banks[0].accounts[0], currency: undefined }]
        }]
      };
      await notifier.sendSummary(noCurrencySummary);
      expect(getText(fetchMock)).toContain('ILS');
    });
  });

  describe('waitForReply', () => {
    it('returns matching reply message from poll', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100' });
      const futureTime = Math.floor(Date.now() / 1000) + 100;
      let callCount = 0;
      fetchMock.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: [] }) });
        if (callCount === 2) return Promise.resolve({ ok: true, text: vi.fn() });
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, result: [{ update_id: 1, message: { chat: { id: -100 }, text: '654321', date: futureTime } }] })
        });
      });
      const result = await notifier.waitForReply('Enter OTP:', 5000);
      expect(result).toBe('654321');
    });

    it('throws timeout when no reply received within timeout', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100' });
      let callCount = 0;
      fetchMock.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: [] }) });
        if (callCount === 2) return Promise.resolve({ ok: true, text: vi.fn() });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: [] }) });
      });
      await expect(notifier.waitForReply('Enter OTP:', 50)).rejects.toThrow('2FA timeout');
    });

    it('ignores reply with date before prompt was sent', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100' });
      let callCount = 0;
      fetchMock.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: [] }) });
        if (callCount === 2) return Promise.resolve({ ok: true, text: vi.fn() });
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, result: [{ update_id: 1, message: { chat: { id: -100 }, text: '111111', date: 0 } }] })
        });
      });
      await expect(notifier.waitForReply('Enter OTP:', 50)).rejects.toThrow('2FA timeout');
    });

    it('ignores command messages starting with /', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100' });
      const futureTime = Math.floor(Date.now() / 1000) + 100;
      let callCount = 0;
      fetchMock.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: [] }) });
        if (callCount === 2) return Promise.resolve({ ok: true, text: vi.fn() });
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, result: [{ update_id: 1, message: { chat: { id: -100 }, text: '/scan', date: futureTime } }] })
        });
      });
      await expect(notifier.waitForReply('Enter OTP:', 50)).rejects.toThrow('2FA timeout');
    });

    it('ignores messages from wrong chatId', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100' });
      const futureTime = Math.floor(Date.now() / 1000) + 100;
      let callCount = 0;
      fetchMock.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: [] }) });
        if (callCount === 2) return Promise.resolve({ ok: true, text: vi.fn() });
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, result: [{ update_id: 1, message: { chat: { id: -999 }, text: '123456', date: futureTime } }] })
        });
      });
      await expect(notifier.waitForReply('Enter OTP:', 50)).rejects.toThrow('2FA timeout');
    });

    it('uses latest offset from getLatestOffset when prior updates exist', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100' });
      const futureTime = Math.floor(Date.now() / 1000) + 100;
      let callCount = 0;
      fetchMock.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, result: [{ update_id: 50 }] })
        });
        if (callCount === 2) return Promise.resolve({ ok: true, text: vi.fn() });
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, result: [{ update_id: 51, message: { chat: { id: -100 }, text: '999888', date: futureTime } }] })
        });
      });
      const result = await notifier.waitForReply('Enter OTP:', 5000);
      expect(result).toBe('999888');
    });

    it('continues polling when pollUpdates response is not ok', async () => {
      const notifier = new TelegramNotifier({ botToken: '123:ABC', chatId: '-100' });
      let callCount = 0;
      fetchMock.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: [] }) });
        if (callCount === 2) return Promise.resolve({ ok: true, text: vi.fn() });
        return Promise.resolve({ ok: false });
      });
      await expect(notifier.waitForReply('Enter OTP:', 50)).rejects.toThrow('2FA timeout');
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
