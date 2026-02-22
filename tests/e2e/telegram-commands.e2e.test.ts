import { describe, it, expect, afterEach } from 'vitest';
import { TelegramNotifier } from '../../src/services/notifications/TelegramNotifier.js';
import { TelegramCommandHandler } from '../../src/services/TelegramCommandHandler.js';
import { AuditLogService } from '../../src/services/AuditLogService.js';
import { createLogger } from '../../src/logger/index.js';
import { createTestSummary } from './helpers/testData.js';
import {
  HAS_TELEGRAM, getTelegramConfig,
  createMessageCollector, cleanupMessages,
} from './helpers/telegramHelpers.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync, unlinkSync } from 'fs';

const collector = createMessageCollector();
const auditFile = join(tmpdir(), `e2e-cmd-audit-${Date.now()}.json`);

describe.runIf(HAS_TELEGRAM)('Telegram Commands E2E', () => {
  const config = HAS_TELEGRAM ? getTelegramConfig() : { botToken: '', chatId: '' };
  let handler: TelegramCommandHandler;
  let auditLog: AuditLogService;

  afterEach(async () => { await cleanupMessages(collector, config); });

  it('delivers /help response to real Telegram', async () => {
    collector.startCapturing();
    const notifier = new TelegramNotifier(config);
    handler = new TelegramCommandHandler(
      async () => 0,
      notifier,
    );

    await handler.handle('/help');
    expect(collector.messageIds.length).toBeGreaterThan(0);
  });

  it('delivers /status response with audit history', async () => {
    collector.startCapturing();
    const notifier = new TelegramNotifier(config);
    auditLog = new AuditLogService(auditFile, 10);
    auditLog.record(createTestSummary());

    handler = new TelegramCommandHandler(
      async () => 0,
      notifier,
      auditLog,
    );

    await handler.handle('/status');
    expect(collector.messageIds.length).toBeGreaterThan(0);

    if (existsSync(auditFile)) unlinkSync(auditFile);
  });

  it('delivers /scan starting message to real Telegram', async () => {
    collector.startCapturing();
    const notifier = new TelegramNotifier(config);
    let importCalled = false;

    handler = new TelegramCommandHandler(
      async () => { importCalled = true; return 0; },
      notifier,
    );

    await handler.handle('/scan');
    expect(importCalled).toBe(true);
    expect(collector.messageIds.length).toBeGreaterThan(0);
  });

  it('delivers /logs response to real Telegram', async () => {
    createLogger({ format: 'words', maxBufferSize: 50 });
    collector.startCapturing();
    const notifier = new TelegramNotifier(config);
    handler = new TelegramCommandHandler(async () => 0, notifier);

    await handler.handle('/logs');
    expect(collector.messageIds.length).toBeGreaterThan(0);
  });

  it('delivers /watch response to real Telegram', async () => {
    collector.startCapturing();
    const notifier = new TelegramNotifier(config);
    handler = new TelegramCommandHandler(
      async () => 0,
      notifier,
    );

    await handler.handle('/watch');
    expect(collector.messageIds.length).toBeGreaterThan(0);
  });
});
