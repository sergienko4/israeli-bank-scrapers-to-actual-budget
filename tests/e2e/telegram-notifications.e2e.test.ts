import { describe, it, expect, afterEach } from 'vitest';
import { TelegramNotifier } from '../../src/services/notifications/TelegramNotifier.js';
import { createTestSummary } from './helpers/testData.js';
import {
  HAS_TELEGRAM, getTelegramConfig, deleteMessage,
  getMyCommands, rateLimitDelay, createMessageCollector,
} from './helpers/telegramHelpers.js';

const collector = createMessageCollector();

describe.runIf(HAS_TELEGRAM)('Telegram Notifications E2E', () => {
  const config = HAS_TELEGRAM ? getTelegramConfig() : { botToken: '', chatId: '' };

  afterEach(async () => {
    collector.stopCapturing();
    for (const id of collector.messageIds) {
      await deleteMessage(config.botToken, config.chatId, id);
    }
    collector.messageIds.length = 0;
    await rateLimitDelay();
  });

  it('delivers compact format summary to real Telegram', async () => {
    collector.startCapturing();
    const notifier = new TelegramNotifier({ ...config, messageFormat: 'compact' });
    const summary = createTestSummary();

    await expect(notifier.sendSummary(summary)).resolves.not.toThrow();
    expect(collector.messageIds.length).toBeGreaterThan(0);
  });

  it('delivers ledger format summary to real Telegram', async () => {
    collector.startCapturing();
    const notifier = new TelegramNotifier({ ...config, messageFormat: 'ledger' });
    const summary = createTestSummary();

    await expect(notifier.sendSummary(summary)).resolves.not.toThrow();
    expect(collector.messageIds.length).toBeGreaterThan(0);
  });

  it('delivers emoji format summary to real Telegram', async () => {
    collector.startCapturing();
    const notifier = new TelegramNotifier({ ...config, messageFormat: 'emoji' });
    const summary = createTestSummary();

    await expect(notifier.sendSummary(summary)).resolves.not.toThrow();
    expect(collector.messageIds.length).toBeGreaterThan(0);
  });

  it('delivers summary (default) format to real Telegram', async () => {
    collector.startCapturing();
    const notifier = new TelegramNotifier({ ...config, messageFormat: 'summary' });
    const summary = createTestSummary();

    await expect(notifier.sendSummary(summary)).resolves.not.toThrow();
    expect(collector.messageIds.length).toBeGreaterThan(0);
  });

  it('delivers error message to real Telegram', async () => {
    collector.startCapturing();
    const notifier = new TelegramNotifier(config);

    await expect(notifier.sendError('E2E test error message <b>bold</b>')).resolves.not.toThrow();
    expect(collector.messageIds.length).toBeGreaterThan(0);
  });

  it('registers and verifies bot commands', async () => {
    const notifier = new TelegramNotifier(config);
    await notifier.registerCommands();
    await rateLimitDelay();

    const commands = await getMyCommands(config.botToken);
    const commandNames = commands.map(c => c.command);

    expect(commandNames).toContain('scan');
    expect(commandNames).toContain('status');
    expect(commandNames).toContain('logs');
    expect(commandNames).toContain('help');
  });
});
