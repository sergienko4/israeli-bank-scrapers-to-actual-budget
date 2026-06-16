/**
 * Receipt OCR DIP proof — the receipt-import consumers depend on the
 * IReceiptOcr abstraction, not the concrete ReceiptOcrService.
 *
 * Test cases (test-cases guideline, 10-field):
 *  - RCPT-DIP-01 (positive): a minimal IReceiptOcr fake drives the
 *    pipeline end-to-end; parsed amount is asserted. Proves the
 *    abstraction seam — if the pipeline still required the concrete
 *    class, the fake would not type-check.
 *  - RCPT-DIP-02 (negative): a fake whose recognize() fails makes the
 *    pipeline resolve to a failure Procedure (no throw, graceful).
 */

import { describe, it, expect, vi } from 'vitest';
import type TelegramNotifier from '../../../src/Services/Notifications/TelegramNotifier.js';
import type { IReceiptOcr } from '../../../src/Services/Receipt/Index.js';
import ReceiptPhotoOcrPipeline from '../../../src/Services/Receipt/ReceiptPhotoOcrPipeline.js';
import { fail, succeed } from '../../../src/Types/ProcedureHelpers.js';
import { assertProcedureSuccess } from '../../helpers/factories.js';

vi.mock('../../../src/Logger/Index.js', () => ({
  getLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  createLogger: vi.fn(),
  deriveLogFormat: vi.fn().mockReturnValue('words'),
}));

/** Formats today's date as DD/MM/YYYY to satisfy the receipt parser. */
function todayDDMMYYYY(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${String(d.getFullYear())}`;
}

/** Builds a fake notifier that returns a fixed image buffer. */
function fakeNotifierReturningPhoto(): TelegramNotifier {
  return {
    downloadPhoto: vi.fn().mockResolvedValue(succeed(Buffer.from('image-bytes'))),
  } as unknown as TelegramNotifier;
}

describe('Receipt OCR DIP — consumers depend on the IReceiptOcr abstraction', () => {
  it('RCPT-DIP-01: drives the pipeline with a minimal IReceiptOcr fake (no concrete ReceiptOcrService)', async () => {
    const fakeOcr: IReceiptOcr = {
      recognize: vi.fn().mockResolvedValue(succeed({ text: `Store\n${todayDDMMYYYY()}\n₪10` })),
    };

    const pipeline = new ReceiptPhotoOcrPipeline(fakeOcr, fakeNotifierReturningPhoto());
    const result = await pipeline.process('file-id-1', () => false);

    assertProcedureSuccess(result);
    expect(fakeOcr.recognize).toHaveBeenCalledOnce();
    expect(result.data.receipt.amount).toBe(10);
  });

  it('RCPT-DIP-02: propagates an OCR failure from the fake as a pipeline failure', async () => {
    const fakeOcr: IReceiptOcr = {
      recognize: vi.fn().mockResolvedValue(fail('ocr unavailable')),
    };

    const pipeline = new ReceiptPhotoOcrPipeline(fakeOcr, fakeNotifierReturningPhoto());
    const result = await pipeline.process('file-id-2', () => false);

    expect(result.success).toBe(false);
    expect(fakeOcr.recognize).toHaveBeenCalledOnce();
  });
});
