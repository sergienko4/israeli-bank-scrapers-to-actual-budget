import { describe, it, expect, vi, beforeEach } from 'vitest';
import TelegramNotifier from '../../../src/Services/Notifications/TelegramNotifier.js';
import type { ITelegramConfig } from '../../../src/Types/Index.js';
import type { IImportSummary } from '../../../src/Services/MetricsService.js';
import {
  fakeImportSummary, fakeAccountMetrics, fakeBankMetrics,
} from '../../helpers/factories.js';

const pinnedAccount = fakeAccountMetrics({
  accountNumber: '0152228812',
  balance: 16242.97,
  currency: 'ILS',
  newTransactions: [
    { date: '2026-02-14', description: 'Transfer from account', amount: 1000 },
    { date: '2026-02-14', description: 'Amex charge', amount: -66211 },
  ],
  existingTransactions: [],
});

const pinnedBank = fakeBankMetrics({
  bankName: 'discount',
  startTime: 0, endTime: 5000, duration: 5000,
  status: 'success',
  transactionsImported: 2, transactionsSkipped: 0,
  reconciliationStatus: 'skipped',
  accounts: [pinnedAccount],
});

const summaryWithTxns = fakeImportSummary({
  totalTransactions: 2, totalDuplicates: 0,
  totalDuration: 5000, averageDuration: 5000,
  successRate: 100,
  banks: [pinnedBank],
});

const failedSummary = fakeImportSummary({
  totalBanks: 2, successfulBanks: 1, failedBanks: 1,
  totalTransactions: 2, totalDuplicates: 0,
  totalDuration: 8000, averageDuration: 4000, successRate: 50,
  banks: [
    fakeBankMetrics({
      bankName: 'discount', startTime: 0, endTime: 5000, duration: 5000,
      status: 'success', transactionsImported: 2, transactionsSkipped: 0, accounts: [],
    }),
    fakeBankMetrics({
      bankName: 'leumi', startTime: 0, endTime: 3000, duration: 3000,
      status: 'failure', error: 'AuthenticationError',
      transactionsImported: 0, transactionsSkipped: 0, accounts: [],
    }),
  ],
});

function getText(fetchMock: any): string {
  return JSON.parse(fetchMock.mock.calls[0][1].body).text;
}

describe('TelegramNotifier', () => {
  let fetchMock: any;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, text: vi.fn() });
    vi.stubGlobal('fetch', fetchMock);
  });

  /**
   * Creates a TelegramNotifier with default bot credentials.
   * @param options - optional config overrides merged with defaults
   * @param maxTransactions - optional max transactions per account
   * @returns configured TelegramNotifier instance
   */
  function createNotifier(
    options?: Partial<ITelegramConfig>,
    maxTransactions?: number,
  ): TelegramNotifier {
    const config: ITelegramConfig = { botToken: '123:ABC', chatId: '-100', ...options };
    return new TelegramNotifier(config, maxTransactions);
  }

  /**
   * Builds an IImportSummary with overridden account properties.
   * @param overrides - properties to spread into the first account
   * @returns IImportSummary with the modified account
   */
  function withAccountOverrides(overrides: Partial<typeof pinnedAccount>): IImportSummary {
    return fakeImportSummary({
      ...summaryWithTxns,
      banks: [fakeBankMetrics({
        ...pinnedBank,
        accounts: [fakeAccountMetrics({ ...pinnedAccount, ...overrides })],
      })],
    });
  }

  /**
   * Asserts that an HTML tag has equal opening and closing counts.
   * @param text - the HTML string to validate
   * @param tag - the tag name to check (must be 'b', 'i', 'code', 'strong', or 'em')
   */
  function expectBalancedTags(text: string, tag: 'b' | 'i' | 'code' | 'strong' | 'em'): void {
    const openTag = `<${tag}>`;
    const closeTag = `</${tag}>`;
    const opens = text.split(openTag).length - 1;
    const closes = text.split(closeTag).length - 1;
    expect(closes).toBe(opens);
  }

  describe('API integration', () => {
    it('calls Telegram API with correct URL and headers', async () => {
      const notifier = createNotifier();
      await notifier.sendSummary(fakeImportSummary());

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.telegram.org/bot123:ABC/sendMessage');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body).chat_id).toBe('-100');
      expect(JSON.parse(options.body).parse_mode).toBe('HTML');
    });

    it('throws on API error', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 401, text: vi.fn().mockResolvedValue('Unauthorized') });
      const notifier = createNotifier();
      await expect(notifier.sendSummary(fakeImportSummary())).rejects.toThrow('Telegram API error 401');
    });
  });

  describe('sendError', () => {
    it('sends formatted error', async () => {
      const notifier = createNotifier();
      await notifier.sendError('Connection failed');
      expect(getText(fetchMock)).toContain('Import Failed');
      expect(getText(fetchMock)).toContain('Connection failed');
    });

    it('escapes HTML', async () => {
      const notifier = createNotifier();
      await notifier.sendError('<script>xss</script>');
      expect(getText(fetchMock)).toContain('&lt;script&gt;');
    });
  });

  describe('format: summary (default)', () => {
    it('uses summary format when no messageFormat set', async () => {
      const notifier = createNotifier();
      await notifier.sendSummary(summaryWithTxns);
      const text = getText(fetchMock);
      expect(text).toContain('Import Summary');
      expect(text).toContain('Transactions: 2 imported');
      expect(text).toContain('discount');
      expect(text).not.toContain('0152228812'); // No account details in summary
    });

    it('bank with duration 0 shows no duration suffix', async () => {
      const notifier = createNotifier();
      const noDurSummary = { ...summaryWithTxns, banks: [{ ...summaryWithTxns.banks[0], duration: 0 }] };
      await notifier.sendSummary(noDurSummary);
      expect(getText(fetchMock)).toContain('discount');
    });

    it('shows warning icon on failures', async () => {
      const notifier = createNotifier();
      await notifier.sendSummary(failedSummary);
      expect(getText(fetchMock)).toContain('⚠️');
      expect(getText(fetchMock)).toContain('AuthenticationError');
    });

    it('handles summary with no banks (empty banks array)', async () => {
      const notifier = createNotifier();
      const emptySummary = { ...summaryWithTxns, banks: [] };
      await notifier.sendSummary(emptySummary);
      const text = getText(fetchMock);
      expect(text).toContain('Import Summary');
      expect(text).not.toContain('discount');
    });

    it('falls back to summary format for unknown messageFormat', async () => {
      const notifier = createNotifier({ messageFormat: 'bogus' as never });
      await notifier.sendSummary(summaryWithTxns);
      expect(getText(fetchMock)).toContain('Import Summary');
    });
  });

  describe('format: compact', () => {
    it('shows transaction details with amounts', async () => {
      const notifier = createNotifier({ messageFormat: 'compact' });
      await notifier.sendSummary(summaryWithTxns);
      const text = getText(fetchMock);
      expect(text).toContain('0152228812');
      expect(text).toContain('Transfer from account');
      expect(text).toContain('+10.00');
      expect(text).toContain('-662.11');
      expect(text).toContain('Balance matched');
    });

    it('shows balance', async () => {
      const notifier = createNotifier({ messageFormat: 'compact' });
      await notifier.sendSummary(summaryWithTxns);
      expect(getText(fetchMock)).toContain('16,242.97');
    });
  });

  describe('format: ledger', () => {
    it('uses monospace code block', async () => {
      const notifier = createNotifier({ messageFormat: 'ledger' });
      await notifier.sendSummary(summaryWithTxns);
      const text = getText(fetchMock);
      expect(text).toContain('<code>');
      expect(text).toContain('</code>');
      expect(text).toContain('Transfer from acco');
      expect(text).toContain('+10.00');
    });

    it('truncates long descriptions', async () => {
      const notifier = createNotifier({ messageFormat: 'ledger' });
      const longSummary = withAccountOverrides({
        newTransactions: [
          { date: '2026-02-14', description: 'Very long transaction description that exceeds limit', amount: 1000 }
        ],
        existingTransactions: [],
      });
      await notifier.sendSummary(longSummary);
      expect(getText(fetchMock)).toContain('..');
    });
  });

  describe('format: emoji', () => {
    it('uses deposit/payment icons', async () => {
      const notifier = createNotifier({ messageFormat: 'emoji' });
      await notifier.sendSummary(summaryWithTxns);
      const text = getText(fetchMock);
      expect(text).toContain('📥'); // deposit
      expect(text).toContain('📤'); // payment
      expect(text).toContain('💳');
      expect(text).toContain('💰');
    });

    it('shows balance with currency', async () => {
      const notifier = createNotifier({ messageFormat: 'emoji' });
      await notifier.sendSummary(summaryWithTxns);
      expect(getText(fetchMock)).toContain('16,242.97 ILS');
    });
  });

  describe('all formats handle failures', () => {
    for (const fmt of ['summary', 'compact', 'ledger', 'emoji'] as const) {
      it(`${fmt} format shows errors`, async () => {
        const notifier = createNotifier({ messageFormat: fmt });
        await notifier.sendSummary(failedSummary);
        const text = getText(fetchMock);
        expect(text).toContain('AuthenticationError');
      });
    }
  });

  describe('maxTransactions', () => {
    it('defaults to 5 transactions per account', async () => {
      const notifier = createNotifier({ messageFormat: 'compact' });
      const txns = Array.from({ length: 10 }, (_, i) => ({
        date: '2026-02-14', description: `Txn ${i + 1}`, amount: -(i + 1) * 100
      }));
      const summary = withAccountOverrides({ newTransactions: txns, existingTransactions: [] });
      await notifier.sendSummary(summary);
      const text = getText(fetchMock);
      expect(text).toContain('Txn 5');
      expect(text).not.toContain('Txn 6');
    });

    it('respects custom maxTransactions value', async () => {
      const notifier = createNotifier({ messageFormat: 'compact' }, 3);
      const txns = Array.from({ length: 10 }, (_, i) => ({
        date: '2026-02-14', description: `Txn ${i + 1}`, amount: -(i + 1) * 100
      }));
      const summary = withAccountOverrides({ newTransactions: txns, existingTransactions: [] });
      await notifier.sendSummary(summary);
      const text = getText(fetchMock);
      expect(text).toContain('Txn 3');
      expect(text).not.toContain('Txn 4');
    });

    it('clamps to 25 maximum', async () => {
      const notifier = createNotifier({ messageFormat: 'compact' }, 50);
      const txns = Array.from({ length: 30 }, (_, i) => ({
        date: '2026-02-14', description: `Txn ${i + 1}`, amount: -(i + 1) * 100
      }));
      const summary = withAccountOverrides({ newTransactions: txns, existingTransactions: [] });
      await notifier.sendSummary(summary);
      const text = getText(fetchMock);
      expect(text).toContain('Txn 25');
      expect(text).not.toContain('Txn 26');
    });
  });

  describe('truncation with HTML tags', () => {
    function buildLongSummary(accountCount: number): IImportSummary {
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
      const notifier = createNotifier({ messageFormat: 'ledger' });
      await notifier.sendSummary(summaryWithTxns);
      expect(getText(fetchMock)).not.toContain('truncated');
    });

    it('ledger: closes unclosed <code> tag after truncation', async () => {
      const notifier = createNotifier({ messageFormat: 'ledger' }, 25);
      await notifier.sendSummary(buildLongSummary(5));
      const text = getText(fetchMock);
      expect(text).toContain('(truncated)');
      expect(text.length).toBeLessThanOrEqual(4096);
      expectBalancedTags(text, 'code');
    });

    it('compact: closes unclosed <b> tag after truncation', async () => {
      const notifier = createNotifier({ messageFormat: 'compact' }, 25);
      await notifier.sendSummary(buildLongSummary(5));
      const text = getText(fetchMock);
      expect(text).toContain('(truncated)');
      expect(text.length).toBeLessThanOrEqual(4096);
      expectBalancedTags(text, 'b');
    });

    it('emoji: closes tags after truncation', async () => {
      const notifier = createNotifier({ messageFormat: 'emoji' }, 25);
      await notifier.sendSummary(buildLongSummary(5));
      const text = getText(fetchMock);
      expect(text).toContain('(truncated)');
      expect(text.length).toBeLessThanOrEqual(4096);
      expectBalancedTags(text, 'b');
    });

    it('no partial HTML tags at cut point', async () => {
      const notifier = createNotifier({ messageFormat: 'ledger' }, 25);
      await notifier.sendSummary(buildLongSummary(5));
      const text = getText(fetchMock);
      // No unclosed < without matching >
      const lastOpen = text.lastIndexOf('<');
      const lastClose = text.lastIndexOf('>');
      expect(lastClose).toBeGreaterThanOrEqual(lastOpen);
    });

    it('summary format truncates without HTML issues', async () => {
      const notifier = createNotifier({ messageFormat: 'summary' });
      const longSummary = buildLongSummary(200);
      longSummary.banks = Array.from({ length: 50 }, (_, i) => ({
        ...summaryWithTxns.banks[0], bankName: `bank-${i}`
      }));
      await notifier.sendSummary(longSummary);
      const text = getText(fetchMock);
      if (text.includes('truncated')) {
        expectBalancedTags(text, 'b');
      }
    });
  });

  describe('bank name HTML escaping', () => {
    const specialCharSummary: IImportSummary = {
      ...summaryWithTxns,
      banks: [{
        ...summaryWithTxns.banks[0],
        bankName: 'Bank <Test> & "Co"',
      }]
    };

    for (const fmt of ['summary', 'compact', 'ledger', 'emoji'] as const) {
      it(`${fmt}: escapes special chars in bank name`, async () => {
        const notifier = createNotifier({ messageFormat: fmt });
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
    const namedAccountSummary = withAccountOverrides({ accountName: 'Savings Account' });

    for (const fmt of ['compact', 'ledger', 'emoji'] as const) {
      it(`${fmt}: shows accountName instead of accountNumber`, async () => {
        const notifier = createNotifier({ messageFormat: fmt });
        await notifier.sendSummary(namedAccountSummary);
        const text = getText(fetchMock);
        expect(text).toContain('Savings Account');
        expect(text).not.toContain('0152228812');
      });

      it(`${fmt}: falls back to accountNumber when accountName is absent`, async () => {
        const notifier = createNotifier({ messageFormat: fmt });
        await notifier.sendSummary(summaryWithTxns);
        expect(getText(fetchMock)).toContain('0152228812');
      });
    }

    it('accountName is HTML-escaped', async () => {
      const notifier = createNotifier({ messageFormat: 'compact' });
      const specialSummary = withAccountOverrides({ accountName: 'Savings & <Main>' });
      await notifier.sendSummary(specialSummary);
      const text = getText(fetchMock);
      expect(text).not.toContain('<Main>');
      expect(text).toContain('&amp;');
      expect(text).toContain('&lt;Main&gt;');
    });
  });

  describe('sendMessage', () => {
    it('delivers text directly', async () => {
      const notifier = createNotifier();
      await notifier.sendMessage('Hello World');
      expect(getText(fetchMock)).toBe('Hello World');
    });
  });

  describe('showTransactions modes', () => {
    it("none: hides all transactions", async () => {
      const notifier = createNotifier({ messageFormat: 'compact', showTransactions: 'none' });
      await notifier.sendSummary(summaryWithTxns);
      const text = getText(fetchMock);
      expect(text).not.toContain('Transfer from account');
      expect(text).not.toContain('Amex charge');
    });

    it("all: includes existing transactions alongside new ones", async () => {
      const notifier = createNotifier({ messageFormat: 'compact', showTransactions: 'all' });
      const summary = withAccountOverrides({
        existingTransactions: [{ date: '2026-01-01', description: 'Old charge', amount: 500 }],
      });
      await notifier.sendSummary(summary);
      expect(getText(fetchMock)).toContain('Old charge');
    });
  });

  describe('reconciliationStatus', () => {
    it("created: shows + prefix for positive reconciliation amount", async () => {
      const notifier = createNotifier({ messageFormat: 'compact' });
      const summary = {
        ...summaryWithTxns,
        banks: [{ ...summaryWithTxns.banks[0], reconciliationStatus: 'created' as const, reconciliationAmount: 5000 }]
      };
      await notifier.sendSummary(summary);
      expect(getText(fetchMock)).toContain('Reconciled: +50.00 ILS');
    });

    it("created: shows no prefix for negative reconciliation amount", async () => {
      const notifier = createNotifier({ messageFormat: 'compact' });
      const summary = {
        ...summaryWithTxns,
        banks: [{ ...summaryWithTxns.banks[0], reconciliationStatus: 'created' as const, reconciliationAmount: -3000 }]
      };
      await notifier.sendSummary(summary);
      expect(getText(fetchMock)).toContain('Reconciled: -30.00 ILS');
    });

    it("already-reconciled: shows 'Already reconciled'", async () => {
      const notifier = createNotifier({ messageFormat: 'compact' });
      const summary = {
        ...summaryWithTxns,
        banks: [{ ...summaryWithTxns.banks[0], reconciliationStatus: 'already-reconciled' as const }]
      };
      await notifier.sendSummary(summary);
      expect(getText(fetchMock)).toContain('Already reconciled');
    });
  });

  describe('account without balance', () => {
    const noBalanceSummary = withAccountOverrides({ balance: undefined, currency: undefined });

    it('compact: omits balance line when balance is undefined', async () => {
      const notifier = createNotifier({ messageFormat: 'compact' });
      await notifier.sendSummary(noBalanceSummary);
      expect(getText(fetchMock)).not.toContain('💰');
    });

    it('ledger: omits balance line when balance is undefined', async () => {
      const notifier = createNotifier({ messageFormat: 'ledger' });
      await notifier.sendSummary(noBalanceSummary);
      expect(getText(fetchMock)).not.toContain('💰');
    });

    it('emoji: omits balance line when balance is undefined', async () => {
      const notifier = createNotifier({ messageFormat: 'emoji' });
      await notifier.sendSummary(noBalanceSummary);
      expect(getText(fetchMock)).not.toContain('💰');
    });
  });

  describe('bank with empty accounts', () => {
    const emptyAccountsSummary = {
      ...summaryWithTxns,
      banks: [{ ...summaryWithTxns.banks[0], accounts: [] }],
    };

    for (const fmt of ['ledger', 'emoji', 'compact'] as const) {
      it(`${fmt}: handles bank where accounts is empty`, async () => {
        const notifier = createNotifier({ messageFormat: fmt });
        await notifier.sendSummary(emptyAccountsSummary);
        expect(getText(fetchMock)).toContain('Import Summary');
      });
    }

    it('ledger: showTransactions none produces no code block', async () => {
      const notifier = createNotifier({ messageFormat: 'ledger', showTransactions: 'none' });
      await notifier.sendSummary(summaryWithTxns);
      expect(getText(fetchMock)).not.toContain('<code>');
    });
  });

  describe('emoji format with duplicates and missing currency', () => {
    it('shows dup count when totalDuplicates > 0', async () => {
      const notifier = createNotifier({ messageFormat: 'emoji' });
      const dupSummary = { ...summaryWithTxns, totalDuplicates: 3 };
      await notifier.sendSummary(dupSummary);
      expect(getText(fetchMock)).toContain('3 dup');
    });

    it('shows ILS when account currency is undefined', async () => {
      const notifier = createNotifier({ messageFormat: 'emoji' });
      const noCurrencySummary = withAccountOverrides({ currency: undefined });
      await notifier.sendSummary(noCurrencySummary);
      expect(getText(fetchMock)).toContain('ILS');
    });

    it('compact: shows ILS when account currency is undefined', async () => {
      const notifier = createNotifier({ messageFormat: 'compact' });
      const noCurrencySummary = withAccountOverrides({ currency: undefined });
      await notifier.sendSummary(noCurrencySummary);
      expect(getText(fetchMock)).toContain('ILS');
    });
  });

  describe('waitForReply', () => {
    it('returns matching reply message from poll', async () => {
      const notifier = createNotifier();
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
      const notifier = createNotifier();
      let callCount = 0;
      fetchMock.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: [] }) });
        if (callCount === 2) return Promise.resolve({ ok: true, text: vi.fn() });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: [] }) });
      });
      await expect(notifier.waitForReply('Enter OTP:', 50)).rejects.toThrow('2FA reply wait timed out');
    });

    it('ignores reply with date before prompt was sent', async () => {
      const notifier = createNotifier();
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
      await expect(notifier.waitForReply('Enter OTP:', 50)).rejects.toThrow('2FA reply wait timed out');
    });

    it('ignores command messages starting with /', async () => {
      const notifier = createNotifier();
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
      await expect(notifier.waitForReply('Enter OTP:', 50)).rejects.toThrow('2FA reply wait timed out');
    });

    it('ignores messages from wrong chatId', async () => {
      const notifier = createNotifier();
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
      await expect(notifier.waitForReply('Enter OTP:', 50)).rejects.toThrow('2FA reply wait timed out');
    });

    it('uses latest offset from getLatestOffset when prior updates exist', async () => {
      const notifier = createNotifier();
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

    it('ignores non-OTP text and sends a hint, then accepts the valid code', async () => {
      const notifier = createNotifier();
      const futureTime = Math.floor(Date.now() / 1000) + 100;
      let callCount = 0;
      fetchMock.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: [] }) });
        if (callCount === 2) return Promise.resolve({ ok: true, text: vi.fn() }); // send prompt
        if (callCount === 3) return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, result: [{ update_id: 1, message: { chat: { id: -100 }, text: 'wait a moment', date: futureTime } }] })
        });
        if (callCount === 4) return Promise.resolve({ ok: true, text: vi.fn() }); // send hint
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, result: [{ update_id: 2, message: { chat: { id: -100 }, text: '187226', date: futureTime } }] })
        });
      });
      const result = await notifier.waitForReply('Enter OTP:', 5000);
      expect(result).toBe('187226');
      const hintBody = JSON.parse(fetchMock.mock.calls[3][1].body).text;
      expect(hintBody).toContain('numeric OTP');
    });

    it('accepts OTP code containing spaces or surrounding text', async () => {
      const notifier = createNotifier();
      const futureTime = Math.floor(Date.now() / 1000) + 100;
      let callCount = 0;
      fetchMock.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: [] }) });
        if (callCount === 2) return Promise.resolve({ ok: true, text: vi.fn() });
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, result: [{ update_id: 1, message: { chat: { id: -100 }, text: 'Code: 654321', date: futureTime } }] })
        });
      });
      const result = await notifier.waitForReply('Enter OTP:', 5000);
      expect(result).toBe('Code: 654321');
    });

    it('continues polling when pollUpdates response is not ok', async () => {
      const notifier = createNotifier();
      let callCount = 0;
      fetchMock.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: [] }) });
        if (callCount === 2) return Promise.resolve({ ok: true, text: vi.fn() });
        return Promise.resolve({ ok: false });
      });
      await expect(notifier.waitForReply('Enter OTP:', 50)).rejects.toThrow('2FA reply wait timed out');
    });

    it('confirms the OTP update offset before returning', async () => {
      const notifier = createNotifier();
      const futureTime = Math.floor(Date.now() / 1000) + 100;
      let callCount = 0;
      fetchMock.mockImplementation(() => {
        callCount++;
        // 1: getLatestOffset
        if (callCount === 1) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: [] }) });
        // 2: send prompt
        if (callCount === 2) return Promise.resolve({ ok: true, text: vi.fn() });
        // 3: poll → OTP reply at update_id=51
        if (callCount === 3) return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, result: [{ update_id: 51, message: { chat: { id: -100 }, text: '123456', date: futureTime } }] }),
        });
        // 4: confirmOffset call (offset=52)
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: [] }) });
      });
      await notifier.waitForReply('Enter OTP:', 5000);
      expect(callCount).toBe(4);
      const confirmUrl: string = fetchMock.mock.calls[3]?.[0] ?? '';
      expect(confirmUrl).toContain('getUpdates');
      expect(confirmUrl).toContain('offset=52');
      expect(confirmUrl).toContain('timeout=0');
    });

    it('two sequential waitForReply calls both succeed (scan-all scenario)', async () => {
      const notifier = createNotifier();
      const futureTime = Math.floor(Date.now() / 1000) + 100;
      let callCount = 0;
      fetchMock.mockImplementation(() => {
        callCount++;
        // ── Bank A OTP flow ──
        // 1: getLatestOffset → empty
        if (callCount === 1) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: [] }) });
        // 2: send prompt A
        if (callCount === 2) return Promise.resolve({ ok: true, text: vi.fn() });
        // 3: poll → Bank A OTP at update_id=51
        if (callCount === 3) return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, result: [{ update_id: 51, message: { chat: { id: -100 }, text: '111111', date: futureTime } }] }),
        });
        // 4: confirmOffset(52)
        if (callCount === 4) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: [] }) });
        // ── Bank B OTP flow ──
        // 5: getLatestOffset → returns update 51 confirmed, latest is empty
        if (callCount === 5) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: [] }) });
        // 6: send prompt B
        if (callCount === 6) return Promise.resolve({ ok: true, text: vi.fn() });
        // 7: poll → Bank B OTP at update_id=52
        if (callCount === 7) return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, result: [{ update_id: 52, message: { chat: { id: -100 }, text: '222222', date: futureTime } }] }),
        });
        // 8: confirmOffset(53)
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: [] }) });
      });

      const resultA = await notifier.waitForReply('OTP for Bank A:', 5000);
      const resultB = await notifier.waitForReply('OTP for Bank B:', 5000);
      expect(resultA).toBe('111111');
      expect(resultB).toBe('222222');
    });

    it('does not return stale OTP from a previous bank', async () => {
      const notifier = createNotifier();
      const pastTime = Math.floor(Date.now() / 1000) - 10;
      const futureTime = Math.floor(Date.now() / 1000) + 100;
      let callCount = 0;
      fetchMock.mockImplementation(() => {
        callCount++;
        // 1: getLatestOffset → last update is 51 (Bank A's stale OTP)
        if (callCount === 1) return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, result: [{ update_id: 51 }] }),
        });
        // 2: send prompt
        if (callCount === 2) return Promise.resolve({ ok: true, text: vi.fn() });
        // 3: poll(offset=52) → Bank A's stale OTP NOT returned (it's before sentAt)
        if (callCount === 3) return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, result: [{ update_id: 52, message: { chat: { id: -100 }, text: '111111', date: pastTime } }] }),
        });
        // 4: poll(offset=53) → Bank B's real OTP
        if (callCount === 4) return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, result: [{ update_id: 53, message: { chat: { id: -100 }, text: '222222', date: futureTime } }] }),
        });
        // 5: confirmOffset(54)
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: [] }) });
      });
      const result = await notifier.waitForReply('OTP for Bank B:', 5000);
      expect(result).toBe('222222');
    });

    it('confirmation failure does not break waitForReply', async () => {
      const notifier = createNotifier();
      const futureTime = Math.floor(Date.now() / 1000) + 100;
      let callCount = 0;
      fetchMock.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, result: [] }) });
        if (callCount === 2) return Promise.resolve({ ok: true, text: vi.fn() });
        if (callCount === 3) return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, result: [{ update_id: 1, message: { chat: { id: -100 }, text: '654321', date: futureTime } }] }),
        });
        // 4: confirmOffset fails
        return Promise.reject(new Error('Network error'));
      });
      const result = await notifier.waitForReply('Enter OTP:', 5000);
      expect(result).toBe('654321');
    });
  });

  describe('registerCommands', () => {
    it('registers base commands via setMyCommands API', async () => {
      const notifier = createNotifier();
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
      const notifier = createNotifier();
      await notifier.registerCommands([{ command: 'watch', description: 'Check spending' }]);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.commands).toHaveLength(5);
      expect(body.commands[2].command).toBe('watch');
    });

    it('filters out invalid commands (uppercase, too long)', async () => {
      const notifier = createNotifier();
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

    it('returns failure on API error', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 400, text: vi.fn().mockResolvedValue('Bad Request') });
      const notifier = createNotifier();
      const result = await notifier.registerCommands();
      expect(result.success).toBe(false);
      expect(result.message).toContain('Failed to register commands');
    });
  });
});
