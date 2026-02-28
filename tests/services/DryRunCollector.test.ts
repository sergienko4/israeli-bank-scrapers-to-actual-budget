import { describe, it, expect } from 'vitest';
import { DryRunCollector, AccountPreview } from '../../src/Services/DryRunCollector.js';
import { BankTransaction } from '../../src/Types/index.js';

const VALID_UUID = '12345678-1234-1234-1234-123456789abc';

function makeTxns(count: number): BankTransaction[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2026-02-${String(i + 1).padStart(2, '0')}`,
    chargedAmount: -(100 + i) * 10,
    description: `Payee ${i + 1}`,
  }));
}

function makePreview(overrides: Partial<AccountPreview> = {}): AccountPreview {
  return {
    bankName: 'discount', accountNumber: '123456',
    balance: 5000, currency: 'ILS',
    transactionCount: 3,
    dateRange: { from: '2026-02-01', to: '2026-02-03' },
    samples: [{ date: '2026-02-01', description: 'Supersal', amount: -120.5 }],
    ...overrides,
  };
}

describe('DryRunCollector', () => {
  describe('recordAccount / getPreview / hasAccounts', () => {
    it('starts empty', () => {
      const c = new DryRunCollector();
      expect(c.hasAccounts()).toBe(false);
      expect(c.getPreview()).toHaveLength(0);
      expect(c.totalTransactions()).toBe(0);
    });

    it('records accounts and accumulates totals', () => {
      const c = new DryRunCollector();
      c.recordAccount(makePreview({ transactionCount: 5 }));
      c.recordAccount(makePreview({ accountNumber: '999', transactionCount: 3 }));
      expect(c.hasAccounts()).toBe(true);
      expect(c.getPreview()).toHaveLength(2);
      expect(c.totalTransactions()).toBe(8);
    });
  });

  describe('buildPreview', () => {
    it('builds preview from raw transactions', () => {
      const txns = makeTxns(5);
      const preview = DryRunCollector.buildPreview({ bankName: 'leumi', accountNumber: '987', balance: 10000, currency: 'ILS', txns });
      expect(preview.bankName).toBe('leumi');
      expect(preview.accountNumber).toBe('987');
      expect(preview.balance).toBe(10000);
      expect(preview.currency).toBe('ILS');
      expect(preview.transactionCount).toBe(5);
      expect(preview.samples).toHaveLength(3); // capped at 3
    });

    it('computes date range from transactions', () => {
      const txns: BankTransaction[] = [
        { date: '2026-02-10', chargedAmount: -100, description: 'A' },
        { date: '2026-02-05', chargedAmount: -50, description: 'B' },
        { date: '2026-02-20', chargedAmount: -75, description: 'C' },
      ];
      const preview = DryRunCollector.buildPreview({ bankName: 'discount', accountNumber: '1', balance: undefined, currency: 'ILS', txns: txns });
      expect(preview.dateRange.from).toBe('2026-02-05');
      expect(preview.dateRange.to).toBe('2026-02-20');
    });

    it('handles empty transactions', () => {
      const preview = DryRunCollector.buildPreview({ bankName: 'leumi', accountNumber: '1', balance: 0, currency: 'ILS', txns: [] });
      expect(preview.transactionCount).toBe(0);
      expect(preview.samples).toHaveLength(0);
      expect(preview.dateRange.from).toBe('N/A');
      expect(preview.dateRange.to).toBe('N/A');
    });

    it('handles undefined balance', () => {
      const preview = DryRunCollector.buildPreview({ bankName: 'leumi', accountNumber: '1', balance: undefined, currency: 'ILS', txns: [] });
      expect(preview.balance).toBeUndefined();
    });
  });

  describe('formatText', () => {
    it('includes DRY RUN header', () => {
      const c = new DryRunCollector();
      c.recordAccount(makePreview());
      expect(c.formatText()).toContain('DRY RUN');
    });

    it('includes bank name and account number', () => {
      const c = new DryRunCollector();
      c.recordAccount(makePreview({ bankName: 'hapoalim', accountNumber: '777' }));
      const text = c.formatText();
      expect(text).toContain('hapoalim');
      expect(text).toContain('777');
    });

    it('includes balance and transaction count', () => {
      const c = new DryRunCollector();
      c.recordAccount(makePreview({ balance: 9999.99, transactionCount: 12 }));
      const text = c.formatText();
      expect(text).toContain('9999.99');
      expect(text).toContain('12');
    });

    it('shows N/A when balance is undefined', () => {
      const c = new DryRunCollector();
      c.recordAccount(makePreview({ balance: undefined }));
      expect(c.formatText()).toContain('N/A');
    });

    it('shows sample transactions', () => {
      const c = new DryRunCollector();
      c.recordAccount(makePreview({
        samples: [{ date: '2026-02-10', description: 'McDonald', amount: -45.5 }],
      }));
      const text = c.formatText();
      expect(text).toContain('McDonald');
      expect(text).toContain('-45.50');
    });

    it('shows summary with correct counts', () => {
      const c = new DryRunCollector();
      c.recordAccount(makePreview({ transactionCount: 7 }));
      c.recordAccount(makePreview({ accountNumber: '999', transactionCount: 3 }));
      const text = c.formatText();
      expect(text).toContain('2 accounts');
      expect(text).toContain('10 transactions');
      expect(text).toContain('0 imported');
    });

    it('uses singular for 1 account and 1 transaction', () => {
      const c = new DryRunCollector();
      c.recordAccount(makePreview({ transactionCount: 1 }));
      const text = c.formatText();
      expect(text).toContain('1 account,');
      expect(text).toContain('1 transaction');
      expect(text).not.toContain('1 accounts');
    });
  });

  describe('formatTelegram', () => {
    it('includes HTML bold tags and Dry Run header', () => {
      const c = new DryRunCollector();
      c.recordAccount(makePreview({ bankName: 'leumi' }));
      const msg = c.formatTelegram();
      expect(msg).toContain('<b>');
      expect(msg).toContain('Dry Run');
      expect(msg).toContain('leumi');
    });

    it('includes sample transactions', () => {
      const c = new DryRunCollector();
      c.recordAccount(makePreview({
        samples: [{ date: '2026-02-15', description: 'Amazon', amount: -89.99 }],
      }));
      expect(c.formatTelegram()).toContain('Amazon');
    });

    it('includes summary line', () => {
      const c = new DryRunCollector();
      c.recordAccount(makePreview({ transactionCount: 5 }));
      expect(c.formatTelegram()).toContain('0 imported');
    });
  });

  describe('date range edge cases', () => {
    it('handles transactions with Date objects', () => {
      const txns: BankTransaction[] = [
        { date: new Date('2026-02-10'), chargedAmount: -100 },
        { date: new Date('2026-02-15'), chargedAmount: -50 },
      ];
      const preview = DryRunCollector.buildPreview({ bankName: 'leumi', accountNumber: '1', balance: 0, currency: 'ILS', txns: txns });
      expect(preview.dateRange.from).toBe('2026-02-10');
      expect(preview.dateRange.to).toBe('2026-02-15');
    });
  });

  describe('positive amount formatting', () => {
    it('shows + sign for positive amounts', () => {
      const c = new DryRunCollector();
      c.recordAccount(makePreview({
        samples: [{ date: '2026-02-01', description: 'Salary', amount: 15000 }],
      }));
      expect(c.formatText()).toContain('+15000.00');
    });
  });
});

describe('formatText with no samples', () => {
  it('omits Recent section when account has no samples', () => {
    const c = new DryRunCollector();
    c.recordAccount(makePreview({ samples: [] }));
    const text = c.formatText();
    expect(text).not.toContain('Recent:');
    expect(text).toContain('discount');
  });
});

describe('parseSample fallbacks', () => {
  it('uses memo when description is missing', () => {
    const txns: BankTransaction[] = [{ date: '2026-02-01', memo: 'Memo payee' }];
    const preview = DryRunCollector.buildPreview({ bankName: 'leumi', accountNumber: '1', balance: 0, currency: 'ILS', txns: txns });
    expect(preview.samples[0].description).toBe('Memo payee');
  });

  it('uses empty string when neither description nor memo', () => {
    const txns: BankTransaction[] = [{ date: '2026-02-01' }];
    const preview = DryRunCollector.buildPreview({ bankName: 'leumi', accountNumber: '1', balance: 0, currency: 'ILS', txns: txns });
    expect(preview.samples[0].description).toBe('');
  });

  it('uses 0 when chargedAmount is missing', () => {
    const txns: BankTransaction[] = [{ date: '2026-02-01', description: 'Fee' }];
    const preview = DryRunCollector.buildPreview({ bankName: 'leumi', accountNumber: '1', balance: 0, currency: 'ILS', txns: txns });
    expect(preview.samples[0].amount).toBe(0);
  });
});
