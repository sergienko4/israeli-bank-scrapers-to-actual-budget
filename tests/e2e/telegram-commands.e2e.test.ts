import { describe, it, expect, afterEach } from 'vitest';
import { TelegramNotifier } from '../../src/Services/Notifications/TelegramNotifier.js';
import { TelegramCommandHandler } from '../../src/Services/TelegramCommandHandler.js';
import { ImportMediator } from '../../src/Services/ImportMediator.js';
import { AuditLogService } from '../../src/Services/AuditLogService.js';
import { createLogger } from '../../src/Logger/Index.js';
import { createTestSummary } from './helpers/testData.js';
import {
  HAS_TELEGRAM, getTelegramConfig,
  createMessageCollector, cleanupMessages,
} from './helpers/telegramHelpers.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync, unlinkSync } from 'fs';

/**
 * Creates a real ImportMediator for E2E tests with a no-op spawn.
 * @returns ImportMediator that resolves immediately with exit code 0.
 */
function createE2eMediator(): ImportMediator {
  return new ImportMediator({
    spawnImport: async () => 0,
    getBankNames: () => ['discount', 'visaCal', 'oneZero'],
    notifier: null,
  });
}

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
    handler = new TelegramCommandHandler({ mediator: createE2eMediator(), notifier });

    await handler.handle('/help');
    expect(collector.messageIds.length).toBeGreaterThan(0);
  });

  it('delivers /status response with audit history', async () => {
    collector.startCapturing();
    const notifier = new TelegramNotifier(config);
    auditLog = new AuditLogService(auditFile, 10);
    auditLog.record(createTestSummary());

    handler = new TelegramCommandHandler({
      mediator: createE2eMediator(), notifier, auditLog,
    });

    await handler.handle('/status');
    expect(collector.messageIds.length).toBeGreaterThan(0);

    if (existsSync(auditFile)) unlinkSync(auditFile);
  });

  it('delivers /scan starting message to real Telegram', async () => {
    collector.startCapturing();
    const notifier = new TelegramNotifier(config);
    const mediator = createE2eMediator();
    handler = new TelegramCommandHandler({ mediator, notifier });

    await handler.handle('/scan');
    // mediator requested the import
    expect(mediator.getLastRunTime()).not.toBeNull();
    expect(collector.messageIds.length).toBeGreaterThan(0);
  });

  it('delivers /logs response to real Telegram', async () => {
    createLogger({ format: 'words', maxBufferSize: 50 });
    collector.startCapturing();
    const notifier = new TelegramNotifier(config);
    handler = new TelegramCommandHandler({ mediator: createE2eMediator(), notifier });

    await handler.handle('/logs');
    expect(collector.messageIds.length).toBeGreaterThan(0);
  });

  it('delivers /watch response to real Telegram', async () => {
    collector.startCapturing();
    const notifier = new TelegramNotifier(config);
    handler = new TelegramCommandHandler({ mediator: createE2eMediator(), notifier });

    await handler.handle('/watch');
    expect(collector.messageIds.length).toBeGreaterThan(0);
  });

  // ─── Callback-based scan commands (inline keyboard buttons) ───

  it('scan_all callback runs import (bypasses menu)', async () => {
    collector.startCapturing();
    const notifier = new TelegramNotifier(config);
    const banks = ['discount', 'visaCal', 'oneZero'];
    const mediator = createE2eMediator();

    handler = new TelegramCommandHandler({
      mediator,
      notifier,
      getBankNames: () => banks,
      sendScanMenu: (b) => notifier.sendScanMenu(b),
    });

    await handler.handle('scan_all');
    expect(mediator.getLastRunTime()).not.toBeNull();
    expect(collector.messageIds.length).toBeGreaterThan(0);
  });

  it('scan:bankName callback runs import for that bank', async () => {
    collector.startCapturing();
    const notifier = new TelegramNotifier(config);
    const mediator = createE2eMediator();

    handler = new TelegramCommandHandler({
      mediator,
      notifier,
      getBankNames: () => ['discount', 'visaCal'],
    });

    await handler.handle('scan:discount');
    expect(mediator.getLastRunTime()).not.toBeNull();
    expect(collector.messageIds.length).toBeGreaterThan(0);
  });

  it('/scan with menu shows inline keyboard (no import)', async () => {
    collector.startCapturing();
    const notifier = new TelegramNotifier(config);
    const mediator = createE2eMediator();
    const banks = ['discount', 'visaCal', 'amex'];

    handler = new TelegramCommandHandler({
      mediator,
      notifier,
      getBankNames: () => banks,
      sendScanMenu: (b) => notifier.sendScanMenu(b),
    });

    await handler.handle('/scan');
    // Menu shown, no import triggered — mediator should have no last run
    expect(mediator.getLastRunTime()).toBeNull();
    expect(collector.messageIds.length).toBeGreaterThan(0);
  });
});
