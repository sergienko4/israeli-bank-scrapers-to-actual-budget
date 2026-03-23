/**
 * E2E test for receipt photo import via Telegram.
 * Uses a real Hebrew receipt fixture image + real Telegram bot.
 * Stubs downloadPhoto to return the fixture (no need to upload via Telegram).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReceiptImportHandler } from '../../src/Services/ReceiptImportHandler.js';
import ReceiptOcrService from '../../src/Services/ReceiptOcrService.js';
import TelegramNotifier from '../../src/Services/Notifications/TelegramNotifier.js';
import { succeed } from '../../src/Types/ProcedureHelpers.js';
import {
  HAS_TELEGRAM,
  getTelegramConfig,
  createMessageCollector,
  cleanupMessages,
} from './helpers/telegramHelpers.js';

const FIXTURES_DIR = join(import.meta.dirname, 'fixtures');
const collector = createMessageCollector();

describe.runIf(HAS_TELEGRAM)('Receipt Import E2E', () => {
  const config = getTelegramConfig();
  const fixtureBuffer = readFileSync(join(FIXTURES_DIR, 'receipt-sample.jpg'));

  afterEach(async () => {
    await cleanupMessages(collector, config);
  });

  it('OCR recognizes Hebrew text from receipt image', async () => {
    const ocr = new ReceiptOcrService();
    const result = await ocr.recognize(fixtureBuffer);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.text.length).toBeGreaterThan(10);
      console.log('OCR text:', result.data.text.substring(0, 200));
    }
  }, 30000);

  it('parses Hebrew receipt fields from OCR text', async () => {
    const ocr = new ReceiptOcrService();
    const ocrResult = await ocr.recognize(fixtureBuffer);
    expect(ocrResult.success).toBe(true);
    if (!ocrResult.success) return;

    const parseResult = ReceiptOcrService.parseReceipt(ocrResult.data.text);
    expect(parseResult.success).toBe(true);
    if (parseResult.success) {
      console.log('Parsed receipt:', JSON.stringify(parseResult.data, null, 2));
      expect(parseResult.data.merchant).toBeDefined();
    }
  }, 30000);

  it('full flow: photo → OCR → receipt detected message sent to Telegram', async () => {
    collector.startCapturing();
    const notifier = new TelegramNotifier(config);
    const ocr = new ReceiptOcrService();

    vi.spyOn(notifier, 'downloadPhoto').mockResolvedValue(
      succeed(fixtureBuffer)
    );

    const handler = new ReceiptImportHandler({
      ocr,
      notifier,
      telegramNotifier: notifier,
    });

    await handler.start();
    const result = await handler.handlePhoto('fixture-file-id');

    // Without Actual Budget API, the flow sends receipt summary
    // but fails when trying to show account selection menu.
    // The key validation: OCR worked and receipt messages were sent.
    console.log('handlePhoto result:', JSON.stringify(result));
    expect(collector.messageIds.length).toBeGreaterThanOrEqual(2);
    console.log(`Sent ${String(collector.messageIds.length)} messages to Telegram`);
  }, 60000);
});
