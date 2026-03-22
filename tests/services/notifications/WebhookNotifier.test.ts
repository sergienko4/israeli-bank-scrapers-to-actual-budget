import { describe, it, expect, vi, beforeEach } from 'vitest';
import WebhookNotifier from '../../../src/Services/Notifications/WebhookNotifier.js';
import { IImportSummary } from '../../../src/Services/MetricsService.js';

const makeSummary = (overrides: Partial<IImportSummary> = {}): IImportSummary => ({
  totalBanks: 2, successfulBanks: 2, failedBanks: 0,
  totalTransactions: 5, totalDuplicates: 3, totalDuration: 10000,
  averageDuration: 5000, successRate: 100,
  banks: [{ bankName: 'discount', startTime: 0, status: 'success', transactionsImported: 5, transactionsSkipped: 3, accounts: [] }],
  ...overrides,
});

describe('WebhookNotifier', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });

  describe('plain format', () => {
    it('sends summary as JSON', async () => {
      const notifier = new WebhookNotifier({ url: 'https://example.com/hook', format: 'plain' });
      await notifier.sendSummary(makeSummary());
      expect(fetchMock).toHaveBeenCalledWith('https://example.com/hook', expect.objectContaining({ method: 'POST' }));
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.event).toBe('import_complete');
      expect(body.totalTransactions).toBe(5);
      expect(body.banks[0].name).toBe('discount');
    });

    it('sends error as JSON', async () => {
      const notifier = new WebhookNotifier({ url: 'https://example.com/hook', format: 'plain' });
      await notifier.sendError('Auth failed');
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.event).toBe('error');
      expect(body.message).toBe('Auth failed');
    });

    it('sends message as JSON', async () => {
      const notifier = new WebhookNotifier({ url: 'https://example.com/hook' }); // default plain
      await notifier.sendMessage('Hello');
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.event).toBe('message');
      expect(body.message).toBe('Hello');
    });
  });

  describe('slack format', () => {
    it('sends summary with Slack text', async () => {
      const notifier = new WebhookNotifier({ url: 'https://hooks.slack.com/test', format: 'slack' });
      await notifier.sendSummary(makeSummary());
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.text).toContain('*Import Summary*');
      expect(body.text).toContain('discount');
    });

    it('sends error with Slack formatting', async () => {
      const notifier = new WebhookNotifier({ url: 'https://hooks.slack.com/test', format: 'slack' });
      await notifier.sendError('Failed');
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.text).toContain('*Import Failed*');
    });
  });

  describe('discord format', () => {
    it('sends summary with Discord content', async () => {
      const notifier = new WebhookNotifier({ url: 'https://discord.com/api/webhooks/test', format: 'discord' });
      await notifier.sendSummary(makeSummary());
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.content).toContain('**Import Summary**');
      expect(body.content).toContain('discount');
    });

    it('sends error with Discord formatting', async () => {
      const notifier = new WebhookNotifier({ url: 'https://discord.com/api/webhooks/test', format: 'discord' });
      await notifier.sendError('Auth failed');
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.content).toContain('**Import Failed**');
    });

    it('sends message with Discord content', async () => {
      const notifier = new WebhookNotifier({ url: 'https://discord.com/api/webhooks/test', format: 'discord' });
      await notifier.sendMessage('Hello');
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.content).toBe('Hello');
    });
  });

  describe('slack format messages', () => {
    it('sends message with Slack text', async () => {
      const notifier = new WebhookNotifier({ url: 'https://hooks.slack.com/test', format: 'slack' });
      await notifier.sendMessage('Hello');
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.text).toBe('Hello');
    });
  });

  describe('slackBankLine edge cases', () => {
    it('slack: shows ⚠️ and ❌ bank + duration + error for failed banks', async () => {
      const notifier = new WebhookNotifier({ url: 'https://hooks.slack.com/test', format: 'slack' });
      const failSummary = makeSummary({
        failedBanks: 1, successfulBanks: 1,
        banks: [
          { bankName: 'discount', startTime: 0, endTime: 5000, duration: 5000, status: 'success', transactionsImported: 3, transactionsSkipped: 0, accounts: [] },
          { bankName: 'leumi', startTime: 0, endTime: 3000, duration: 3000, status: 'failure', error: 'Auth failed', transactionsImported: 0, transactionsSkipped: 0, accounts: [] }
        ]
      });
      await notifier.sendSummary(failSummary);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.text).toContain('⚠️');
      expect(body.text).toContain('❌ leumi');
      expect(body.text).toContain('Auth failed');
      expect(body.text).toContain('5.0s');
    });

    it('discord: shows ⚠️ and ❌ bank for failed banks', async () => {
      const notifier = new WebhookNotifier({ url: 'https://discord.com/api/webhooks/test', format: 'discord' });
      const failSummary = makeSummary({
        failedBanks: 1,
        banks: [{ bankName: 'leumi', startTime: 0, endTime: 3000, duration: 3000, status: 'failure', error: 'Timeout', transactionsImported: 0, transactionsSkipped: 0, accounts: [] }]
      });
      await notifier.sendSummary(failSummary);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.content).toContain('⚠️');
      expect(body.content).toContain('❌ leumi');
      expect(body.content).toContain('Timeout');
    });
  });

  describe('error handling', () => {
    it('throws on non-ok response', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('Server error') });
      const notifier = new WebhookNotifier({ url: 'https://example.com/hook' });
      await expect(notifier.sendSummary(makeSummary())).rejects.toThrow('Webhook error 500');
    });
  });
});
