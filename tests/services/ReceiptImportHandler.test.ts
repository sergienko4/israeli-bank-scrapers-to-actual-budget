import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import type { INotifier } from '../../src/Services/Notifications/INotifier.js';
import type TelegramNotifier from '../../src/Services/Notifications/TelegramNotifier.js';
import { ReceiptImportHandler } from '../../src/Services/ReceiptImportHandler.js';
import type { IReceiptActualApi } from '../../src/Services/ReceiptImportHandler.js';
import ReceiptOcrService from '../../src/Services/ReceiptOcrService.js';
import { succeed, fail } from '../../src/Types/ProcedureHelpers.js';

/** Partial INotifier with only the methods used in tests. */
type MockNotifier = Pick<INotifier, 'sendMessage' | 'sendSummary' | 'sendError'>;
/** Partial TelegramNotifier with methods used in receipt handler tests. */
type MockTelegramNotifier = MockNotifier & Pick<TelegramNotifier, 'downloadPhoto' | 'sendInlineMenu'>;

const mockLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** Formats a date as DD/MM/YYYY for OCR test fixtures. */
function todayDDMMYYYY(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${String(d.getFullYear())}`;
}
const TODAY = todayDDMMYYYY();

vi.mock('../../src/Logger/Index.js', () => ({
  getLogger: () => mockLogger,
  createLogger: vi.fn(),
  deriveLogFormat: vi.fn().mockReturnValue('words'),
}));

/** Creates a mock notifier for tests. */
function createMockNotifier() {
  return {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendSummary: vi.fn().mockResolvedValue(undefined),
    sendError: vi.fn().mockResolvedValue(undefined),
  };
}

/** Creates a mock TelegramNotifier for tests. */
function createMockTelegramNotifier() {
  return {
    ...createMockNotifier(),
    downloadPhoto: vi.fn().mockResolvedValue(succeed(Buffer.from('fake-image'))),
    sendInlineMenu: vi.fn().mockResolvedValue(succeed({ status: 'menu-sent' })),
    sendScanMenu: vi.fn().mockResolvedValue(undefined),
  };
}

/** Creates a mock Actual Budget API for tests. */
function createMockApi(): IReceiptActualApi {
  return {
    getAccounts: vi.fn().mockResolvedValue([
      { id: 'acc-1', name: 'Checking' },
      { id: 'acc-2', name: 'Credit Card' },
    ]),
    getCategories: vi.fn().mockResolvedValue([
      { id: 'cat-1', name: 'Groceries' },
      { id: 'cat-2', name: 'Dining' },
    ]),
    q: vi.fn().mockReturnValue({
      filter: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue('mock-query'),
        }),
      }),
    }),
    aqlQuery: vi.fn().mockResolvedValue({ data: [] }),
    importTransactions: vi.fn().mockResolvedValue(undefined),
  };
}

describe('ReceiptImportHandler', () => {
  let handler: ReceiptImportHandler;
  let mockNotifier: ReturnType<typeof createMockNotifier>;
  let mockTgNotifier: ReturnType<typeof createMockTelegramNotifier>;
  let mockApi: ReturnType<typeof createMockApi>;
  let mockOcr: ReceiptOcrService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockNotifier = createMockNotifier();
    mockTgNotifier = createMockTelegramNotifier();
    mockApi = createMockApi();
    mockOcr = new ReceiptOcrService();

    handler = new ReceiptImportHandler({
      ocr: mockOcr,
      notifier: mockNotifier as MockNotifier as INotifier,
      telegramNotifier: mockTgNotifier as MockTelegramNotifier as TelegramNotifier,
      api: mockApi,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('start', () => {
    it('sends prompt and sets state to awaiting_photo', async () => {
      const result = await handler.start();
      expect(result.success).toBe(true);
      expect(result.data.status).toBe('awaiting-photo');
      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('Send a photo')
      );
      expect(handler.isAwaitingPhoto).toBe(true);
    });
  });

  describe('handlePhoto', () => {
    it('rejects photo when not awaiting', async () => {
      const result = await handler.handlePhoto('file-123');
      expect(result.success).toBe(true);
      expect(result.data.status).toBe('unexpected-photo');
      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('/import_receipt first')
      );
    });

    it('processes photo after start', async () => {
      mockTgNotifier.downloadPhoto.mockResolvedValue(
        succeed(Buffer.from('fake-receipt-image'))
      );
      vi.spyOn(mockOcr, 'recognize').mockResolvedValue(
        succeed({ text: `Super-Pharm\n${TODAY}\n₪125.50` })
      );
      await handler.start();
      const result = await handler.handlePhoto('file-123');
      expect(result.success).toBe(true);
      expect(mockTgNotifier.downloadPhoto).toHaveBeenCalledWith('file-123');
      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('Receipt detected')
      );
    });

    it('reports download failure', async () => {
      mockTgNotifier.downloadPhoto.mockResolvedValue(
        fail('HTTP 404')
      );
      await handler.start();
      const result = await handler.handlePhoto('bad-file');
      expect(result.success).toBe(false);
      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('Download failed')
      );
    });

    it('reports OCR failure', async () => {
      vi.spyOn(mockOcr, 'recognize').mockResolvedValue(
        fail('OCR engine error')
      );
      await handler.start();
      const result = await handler.handlePhoto('file-123');
      expect(result.success).toBe(false);
      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('OCR failed')
      );
    });
  });

  describe('smart payee matching', () => {
    it('shows smart match when previous transaction found', async () => {
      mockApi.aqlQuery.mockResolvedValue({
        data: [{ account: 'acc-1', category: 'cat-1' }],
      });
      vi.spyOn(mockOcr, 'recognize').mockResolvedValue(
        succeed({ text: `Super-Pharm\n${TODAY}\n₪50` })
      );
      await handler.start();
      await handler.handlePhoto('file-123');
      expect(mockTgNotifier.sendInlineMenu).toHaveBeenCalledWith(
        expect.stringContaining('Found previous import'),
        expect.arrayContaining([
          expect.arrayContaining([
            expect.objectContaining({ callback_data: 'receipt_confirm' }),
          ]),
        ])
      );
    });

    it('shows account menu when no match found', async () => {
      mockApi.aqlQuery.mockResolvedValue({ data: [] });
      vi.spyOn(mockOcr, 'recognize').mockResolvedValue(
        succeed({ text: `New Store\n${TODAY}\n₪30` })
      );
      await handler.start();
      await handler.handlePhoto('file-123');
      expect(mockTgNotifier.sendInlineMenu).toHaveBeenCalledWith(
        expect.stringContaining('Select account'),
        expect.any(Array)
      );
    });
  });

  describe('account and category selection', () => {
    it('shows category menu after account selection', async () => {
      await handler.onAccountSelected('acc-1');
      expect(mockTgNotifier.sendInlineMenu).toHaveBeenCalledWith(
        expect.stringContaining('Select category'),
        expect.any(Array)
      );
    });

    it('executes import after category selection and writes to API', async () => {
      vi.spyOn(mockOcr, 'recognize').mockResolvedValue(
        succeed({ text: `Store\n${TODAY}\n₪100` })
      );
      await handler.start();
      await handler.handlePhoto('file-123');
      await handler.onAccountSelected('acc-1');
      const result = await handler.onCategorySelected('cat-1');
      expect(result.success).toBe(true);
      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('Imported')
      );
      expect(mockApi.importTransactions).toHaveBeenCalledTimes(1);
      expect(mockApi.importTransactions).toHaveBeenCalledWith(
        'acc-1',
        expect.arrayContaining([expect.objectContaining({ category: 'cat-1' })])
      );
    });

    it('fails import when API is missing at write time', async () => {
      vi.spyOn(mockOcr, 'recognize').mockResolvedValue(
        succeed({ text: `Store\n${TODAY}\n₪100` })
      );
      await handler.start();
      await handler.handlePhoto('file-123');
      await handler.onAccountSelected('acc-1');
      handler.setApi(undefined as never);
      const result = await handler.onCategorySelected('cat-1');
      expect(result.success).toBe(false);
      expect(mockApi.importTransactions).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('resets state and sends cancellation message', async () => {
      await handler.start();
      const result = await handler.onCancel();
      expect(result.success).toBe(true);
      expect(result.data.status).toBe('cancelled');
      expect(handler.isAwaitingPhoto).toBe(false);
    });
  });

  describe('timeout', () => {
    it('resets state after 2 minutes', async () => {
      await handler.start();
      expect(handler.isAwaitingPhoto).toBe(true);
      await vi.advanceTimersByTimeAsync(120001);
      expect(handler.isAwaitingPhoto).toBe(false);
    });
  });

  describe('onConfirm', () => {
    it('imports with pre-selected account and category', async () => {
      vi.spyOn(mockOcr, 'recognize').mockResolvedValue(
        succeed({ text: `Store\n${TODAY}\n₪50` })
      );
      mockApi.aqlQuery.mockResolvedValue({
        data: [{ account: 'acc-1', category: 'cat-1' }],
      });
      await handler.start();
      await handler.handlePhoto('file-123');
      const result = await handler.onConfirm();
      expect(result.success).toBe(true);
      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('Imported')
      );
    });
  });

  describe('onChooseDifferent', () => {
    it('shows full account menu', async () => {
      const result = await handler.onChooseDifferent();
      expect(mockTgNotifier.sendInlineMenu).toHaveBeenCalledWith(
        expect.stringContaining('Select account'),
        expect.any(Array)
      );
      expect(result.success).toBe(true);
    });
  });

  describe('no API', () => {
    it('fails gracefully when API not set for account menu', async () => {
      const noApiHandler = new ReceiptImportHandler({
        ocr: mockOcr,
        notifier: mockNotifier as MockNotifier as INotifier,
        telegramNotifier: mockTgNotifier as MockTelegramNotifier as TelegramNotifier,
      });
      const result = await noApiHandler.onAccountSelected('acc-1');
      expect(result.success).toBe(false);
    });

    it('fails gracefully when API not set for category menu', async () => {
      const noApiHandler = new ReceiptImportHandler({
        ocr: mockOcr,
        notifier: mockNotifier as MockNotifier as INotifier,
        telegramNotifier: mockTgNotifier as MockTelegramNotifier as TelegramNotifier,
      });
      const result = await noApiHandler.onCategorySelected('cat-1');
      expect(result.success).toBe(false);
    });
  });

  describe('error paths', () => {
    it('handles incomplete state on confirm', async () => {
      const result = await handler.onConfirm();
      expect(result.success).toBe(false);
    });

    it('handles API error during account menu', async () => {
      mockApi.getAccounts.mockRejectedValueOnce(new Error('DB down'));
      const result = await handler.onChooseDifferent();
      expect(result.success).toBe(false);
    });

    it('handles API error during category menu', async () => {
      mockApi.getCategories.mockRejectedValueOnce(new Error('DB down'));
      await handler.onAccountSelected('acc-1');
      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('Cannot fetch categories')
      );
    });

    it('imports with Unknown names when API fails during resolve', async () => {
      vi.spyOn(mockOcr, 'recognize').mockResolvedValue(
        succeed({ text: `Store\n${TODAY}\n₪50` })
      );
      mockApi.aqlQuery.mockResolvedValue({ data: [] });
      await handler.start();
      await handler.handlePhoto('file-123');
      await handler.onAccountSelected('acc-1');
      mockApi.getAccounts.mockRejectedValue(new Error('crash'));
      mockApi.getCategories.mockRejectedValue(new Error('crash'));
      const result = await handler.onCategorySelected('cat-1');
      expect(result.success).toBe(true);
      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });

    it('handles parse failure on empty OCR result', async () => {
      vi.spyOn(mockOcr, 'recognize').mockResolvedValue(
        succeed({ text: '' })
      );
      await handler.start();
      const result = await handler.handlePhoto('file-123');
      expect(result.success).toBe(false);
    });
  });

  describe('findPayeeMatch error path', () => {
    it('returns false when API query throws', async () => {
      mockApi.aqlQuery.mockRejectedValue(new Error('DB crash'));
      vi.spyOn(mockOcr, 'recognize').mockResolvedValue(
        succeed({ text: `Store\n${TODAY}\n₪50` })
      );
      await handler.start();
      await handler.handlePhoto('file-123');
      // Should show account menu (no smart match) rather than crash
      expect(mockTgNotifier.sendInlineMenu).toHaveBeenCalledWith(
        expect.stringContaining('Select account'),
        expect.any(Array)
      );
    });
  });

  describe('executeImport error path', () => {
    it('handles error during doImport (resolveName fails)', async () => {
      vi.spyOn(mockOcr, 'recognize').mockResolvedValue(
        succeed({ text: `Store\n${TODAY}\n₪50` })
      );
      mockApi.aqlQuery.mockResolvedValue({ data: [] });
      await handler.start();
      await handler.handlePhoto('file-123');
      await handler.onAccountSelected('acc-1');
      mockApi.getAccounts.mockRejectedValue(new Error('network'));
      mockApi.getCategories.mockRejectedValue(new Error('network'));
      const result = await handler.onCategorySelected('cat-1');
      expect(result.success).toBe(true);
    });

    it('catches thrown error in executeImport and returns fail', async () => {
      vi.spyOn(mockOcr, 'recognize').mockResolvedValue(
        succeed({ text: `Store\n${TODAY}\n₪50` })
      );
      mockApi.aqlQuery.mockResolvedValue({ data: [] });
      await handler.start();
      await handler.handlePhoto('file-123');
      await handler.onAccountSelected('acc-1');
      // Make getLogger().info throw to trigger the catch in executeImport's doImport
      const originalImpl = mockLogger.info.getMockImplementation();
      mockLogger.info.mockImplementation(() => { throw new Error('logger crashed'); });
      const result = await handler.onCategorySelected('cat-1');
      // Restore the mock to avoid polluting subsequent tests
      if (originalImpl) mockLogger.info.mockImplementation(originalImpl);
      else mockLogger.info.mockImplementation(() => {});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.message).toContain('import failed');
      }
    });

  });

  describe('reply catch path', () => {
    it('continues normally when sendMessage throws in reply', async () => {
      // Handler starts in idle phase, so handlePhoto will hit the
      // "not awaiting_photo" branch which calls reply(). Making sendMessage
      // throw exercises the catch block at line 386.
      mockNotifier.sendMessage.mockRejectedValue(new Error('network down'));
      const result = await handler.handlePhoto('file-123');
      // The reply catch returns succeed({ status: 'reply-failed' }) but the caller
      // proceeds normally; the outer method still returns its own result
      expect(result.success).toBe(true);
      expect(result.data.status).toBe('unexpected-photo');
    });
  });

  describe('setApi', () => {
    it('enables API-dependent features after construction', async () => {
      const noApiHandler = new ReceiptImportHandler({
        ocr: mockOcr,
        notifier: mockNotifier as MockNotifier as INotifier,
        telegramNotifier: mockTgNotifier as MockTelegramNotifier as TelegramNotifier,
      });
      noApiHandler.setApi(mockApi);
      const result = await noApiHandler.onChooseDifferent();
      expect(result.success).toBe(true);
    });
  });

  describe('extractFields defaults', () => {
    it('rejects import when receipt has no date or amount', async () => {
      vi.spyOn(mockOcr, 'recognize').mockResolvedValue(
        succeed({ text: 'Random text\nwith no parseable data' })
      );
      mockApi.aqlQuery.mockResolvedValue({ data: [] });
      await handler.start();
      await handler.handlePhoto('file-123');
      await handler.onAccountSelected('acc-1');
      const result = await handler.onCategorySelected('cat-1');
      expect(result.success).toBe(false);
      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('Missing date or amount')
      );
    });
  });

  describe('resolveName edge cases', () => {
    it('fails import when API is removed before write', async () => {
      vi.spyOn(mockOcr, 'recognize').mockResolvedValue(
        succeed({ text: `Store\n${TODAY}\n₪50` })
      );
      mockApi.aqlQuery.mockResolvedValue({ data: [] });
      await handler.start();
      await handler.handlePhoto('file-123');
      await handler.onAccountSelected('acc-1');
      handler.setApi(undefined as never);
      const result = await handler.onCategorySelected('cat-1');
      // writeToActualBudget returns fail when API is missing
      expect(result.success).toBe(false);
      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('API not connected')
      );
    });

    it('returns Unknown when account ID not found in list', async () => {
      vi.spyOn(mockOcr, 'recognize').mockResolvedValue(
        succeed({ text: `Store\n${TODAY}\n₪50` })
      );
      mockApi.aqlQuery.mockResolvedValue({ data: [] });
      await handler.start();
      await handler.handlePhoto('file-123');
      await handler.onAccountSelected('nonexistent-acc');
      const result = await handler.onCategorySelected('nonexistent-cat');
      expect(result.success).toBe(true);
      // The names won't be found, so resolveName returns 'Unknown'
      expect(mockNotifier.sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('Unknown')
      );
    });
  });

  describe('timeout edge cases', () => {
    it('timeout callback is no-op when state is already idle', async () => {
      await handler.start();
      expect(handler.isAwaitingPhoto).toBe(true);
      // Cancel to reset to idle BEFORE the timeout fires
      await handler.onCancel();
      expect(handler.isAwaitingPhoto).toBe(false);
      // Now advance timers past timeout — the callback fires but state is already idle
      await vi.advanceTimersByTimeAsync(120001);
      // Handler should still be in idle state
      expect(handler.isAwaitingPhoto).toBe(false);
    });
  });
});
