import { describe, it, expect, vi, beforeEach } from 'vitest';
import ReceiptOcrService from '../../src/Services/ReceiptOcrService.js';

const mockLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock('../../src/Logger/Index.js', () => ({
  getLogger: () => mockLogger,
  createLogger: vi.fn(),
  deriveLogFormat: vi.fn().mockReturnValue('words'),
}));

vi.mock('sharp', () => {
  const pipeline = {
    metadata: vi.fn().mockResolvedValue({ width: 800 }),
    resize: vi.fn().mockReturnThis(),
    greyscale: vi.fn().mockReturnThis(),
    threshold: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('processed')),
  };
  return { default: vi.fn().mockReturnValue(pipeline) };
});

vi.mock('tesseract.js', () => ({
  createWorker: vi.fn().mockResolvedValue({
    recognize: vi.fn().mockResolvedValue({ data: { text: 'Mock OCR text' } }),
    terminate: vi.fn().mockResolvedValue(undefined),
  }),
}));

describe('ReceiptOcrService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recognize', () => {
    it('returns recognized text from tesseract', async () => {
      const service = new ReceiptOcrService();
      const result = await service.recognize(Buffer.from('fake-image'));
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.text).toBe('Mock OCR text');
    });

    it('returns failure when OCR produces empty text', async () => {
      const { createWorker } = await import('tesseract.js');
      (createWorker as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        recognize: vi.fn().mockResolvedValue({ data: { text: '' } }),
        terminate: vi.fn().mockResolvedValue(undefined),
      });
      const service = new ReceiptOcrService();
      const result = await service.recognize(Buffer.from('blank'));
      expect(result.success).toBe(false);
    });

    it('returns failure when tesseract throws', async () => {
      const { createWorker } = await import('tesseract.js');
      (createWorker as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('worker crash'));
      const service = new ReceiptOcrService();
      const result = await service.recognize(Buffer.from('bad'));
      expect(result.success).toBe(false);
      if (!result.success) expect(result.message).toContain('worker crash');
    });
  });

  describe('parseReceipt — date extraction', () => {
    it('DD/MM/YYYY format', () => {
      const result = ReceiptOcrService.parseReceipt('Store\n22/03/2026\nסה"כ ₪125.50');
      expect(result.data.date).toBe('2026-03-22');
    });

    it('DD.MM.YY format', () => {
      const result = ReceiptOcrService.parseReceipt('Store\n15.01.26\nTotal 50.00');
      expect(result.data.date).toBe('2026-01-15');
    });

    it('DD-MM-YYYY format', () => {
      const result = ReceiptOcrService.parseReceipt('Store\n01-12-2021\nAmount 100');
      expect(result.data.date).toBe('2021-12-01');
    });

    it('date embedded in Hebrew line: תאריך: 15/06/2025', () => {
      const result = ReceiptOcrService.parseReceipt('חנות\nתאריך: 15/06/2025\nסה"כ 50.00');
      expect(result.data.date).toBe('2025-06-15');
    });

    it('rejects invalid month (13)', () => {
      const result = ReceiptOcrService.parseReceipt('Store\n22/13/2026\n₪50');
      expect(result.data.date).toBeUndefined();
    });

    it('rejects invalid day (32)', () => {
      const result = ReceiptOcrService.parseReceipt('Store\n32/01/2026\n₪50');
      expect(result.data.date).toBeUndefined();
    });

    it('rejects day 0', () => {
      const result = ReceiptOcrService.parseReceipt('Store\n00/01/2026\n₪50');
      expect(result.data.date).toBeUndefined();
    });
  });

  describe('parseReceipt — amount extraction', () => {
    it('₪ prefix: ₪125.50', () => {
      const result = ReceiptOcrService.parseReceipt('Store\n₪125.50\n22/03/2026');
      expect(result.data.amount).toBe(125.5);
    });

    it('ILS suffix: 200.00 ILS', () => {
      const result = ReceiptOcrService.parseReceipt('Store\n200.00 ILS\n22/03/2026');
      expect(result.data.amount).toBe(200);
    });

    it('Hebrew total: סה"כ 99.90', () => {
      const result = ReceiptOcrService.parseReceipt('Store\nסה"כ 99.90\n22/03/2026');
      expect(result.data.amount).toBe(99.9);
    });

    it('Hebrew total with colon: סה"כ: ₪1,234.56', () => {
      const result = ReceiptOcrService.parseReceipt('Store\nסה"כ: ₪1,234.56');
      expect(result.data.amount).toBe(1234.56);
    });

    it('to pay: לתשלום 7722.00', () => {
      const result = ReceiptOcrService.parseReceipt('Store\nלתשלום 7722.00');
      expect(result.data.amount).toBe(7722);
    });

    it('RTL amount before label: 5600.00 סה"כ', () => {
      const result = ReceiptOcrService.parseReceipt('Store\n5600.00 סה"כ לאחר הנחה');
      expect(result.data.amount).toBe(5600);
    });

    it('RTL amount before לתשלום: 772.00 = לתשלום', () => {
      const result = ReceiptOcrService.parseReceipt('Store\n772.00 = לתשלום');
      expect(result.data.amount).toBe(772);
    });

    it('OCR misread סה"ג instead of סה"כ', () => {
      const result = ReceiptOcrService.parseReceipt('Store\nסה"ג 450.00');
      expect(result.data.amount).toBe(450);
    });

    it('שולם (paid) pattern', () => {
      const result = ReceiptOcrService.parseReceipt('Store\nשולם 350.00');
      expect(result.data.amount).toBe(350);
    });

    it('prioritizes לתשלום over סה"כ', () => {
      const text = 'Store\nסה"כ 100.00\nמע"מ 17.00\nלתשלום 117.00';
      const result = ReceiptOcrService.parseReceipt(text);
      expect(result.data.amount).toBe(117);
    });

    it('no amount returns undefined', () => {
      const result = ReceiptOcrService.parseReceipt('Just text\nNo numbers');
      expect(result.data.amount).toBeUndefined();
    });

    it('ש"ח suffix: 89.90 ש"ח', () => {
      const result = ReceiptOcrService.parseReceipt('Store\n89.90 ש"ח');
      expect(result.data.amount).toBe(89.9);
    });
  });

  describe('parseReceipt — merchant extraction', () => {
    it('first meaningful line', () => {
      const result = ReceiptOcrService.parseReceipt('Super-Pharm\nTel Aviv\n₪50.00');
      expect(result.data.merchant).toBe('Super-Pharm');
    });

    it('skips business registration number line', () => {
      const text = '305288508 לניסיון עוסק מורשה\nראשוני הראשונים\nחשבונית מס';
      const result = ReceiptOcrService.parseReceipt(text);
      expect(result.data.merchant).toBe('ראשוני הראשונים');
    });

    it('skips חשבונית מס line', () => {
      const text = 'חשבונית מס קבלה מספר 001\nסופר פארם\n₪50.00';
      const result = ReceiptOcrService.parseReceipt(text);
      expect(result.data.merchant).toBe('סופר פארם');
    });

    it('skips עוסק מורשה line', () => {
      const text = 'עוסק מורשה 12345678\nרמי לוי שיווק\n01/01/2025';
      const result = ReceiptOcrService.parseReceipt(text);
      expect(result.data.merchant).toBe('רמי לוי שיווק');
    });

    it('skips date-only lines', () => {
      const text = '22/03/2026\nAroma TLV\n₪35.00';
      const result = ReceiptOcrService.parseReceipt(text);
      expect(result.data.merchant).toBe('Aroma TLV');
    });

    it('skips digit-only lines', () => {
      const text = '12345678\n050-1234567\nקפה קפה\n₪22.00';
      const result = ReceiptOcrService.parseReceipt(text);
      expect(result.data.merchant).toBe('קפה קפה');
    });

    it('extracts name from לכבוד: line', () => {
      const text = 'לכבוד: ברק חברה לפיתוח\nרחוב הרצל 54\n₪150.00';
      const result = ReceiptOcrService.parseReceipt(text);
      expect(result.data.merchant).toBe('ברק חברה לפיתוח');
    });

    it('strips RTL markers from merchant name', () => {
      const text = '\u200Fסופר פארם\u200E\n₪50.00';
      const result = ReceiptOcrService.parseReceipt(text);
      expect(result.data.merchant).toBe('סופר פארם');
    });
  });

  describe('parseReceipt — realistic Israeli receipt OCR', () => {
    it('supermarket receipt (Rami Levy style)', () => {
      const text = [
        '51234567 ע.מ.',
        'רמי לוי שיווק השקמה בע"מ',
        'סניף 42 - ראשון לציון',
        'תאריך: 15/03/2026 שעה: 14:32',
        'קופאית: מיכל',
        '',
        'חלב תנובה 3% 1ל     6.90',
        'לחם אחיד               7.90',
        'עגבניות קג             12.50',
        '',
        'סה"כ:                 27.30',
        'מע"מ 17%:              3.96',
        'לתשלום:               31.26',
        'שולם באשראי',
      ].join('\n');
      const result = ReceiptOcrService.parseReceipt(text);
      expect(result.data.date).toBe('2026-03-15');
      expect(result.data.amount).toBe(31.26);
      expect(result.data.merchant).toBe('רמי לוי שיווק השקמה בע"מ');
    });

    it('pharmacy receipt (Super-Pharm style)', () => {
      const text = [
        'עוסק מורשה 513456789',
        'סופר-פארם (ישראל) בע"מ',
        'דיזנגוף סנטר, תל אביב',
        '22/03/2026',
        'אדוויל 200מג    ₪29.90',
        'שמפו הד אנד שולד ₪24.90',
        'סה"כ ₪54.80',
        'שולם במזומן',
      ].join('\n');
      const result = ReceiptOcrService.parseReceipt(text);
      expect(result.data.date).toBe('2026-03-22');
      expect(result.data.amount).toBe(54.80);
      expect(result.data.merchant).toBe('סופר-פארם (ישראל) בע"מ');
    });

    it('restaurant receipt with tip', () => {
      const text = [
        'מסעדת שמש',
        'רחוב הרצל 15, חיפה',
        '20/03/2026 21:45',
        'שולחן 7',
        'המבורגר 250ג     65.00',
        'סלט יווני         42.00',
        'בירה גולדסטאר      28.00',
        'סה"כ             135.00',
        'שירות 10%         13.50',
        'לתשלום           148.50',
      ].join('\n');
      const result = ReceiptOcrService.parseReceipt(text);
      expect(result.data.date).toBe('2026-03-20');
      expect(result.data.amount).toBe(148.50);
      expect(result.data.merchant).toBe('מסעדת שמש');
    });

    it('gas station receipt', () => {
      const text = [
        'חשבונית מס קבלה',
        'דלק - תחנת דלק רמת גן',
        '05/03/2026 08:15',
        'סוג דלק: 95',
        'ליטרים: 35.2',
        'מחיר לליטר: 7.12',
        'סה"כ: 250.62',
        'מע"מ: 36.36',
        'לתשלום: 250.62',
      ].join('\n');
      const result = ReceiptOcrService.parseReceipt(text);
      expect(result.data.date).toBe('2026-03-05');
      expect(result.data.amount).toBe(250.62);
      expect(result.data.merchant).toBe('דלק - תחנת דלק רמת גן');
    });

    it('real OCR output with RTL markers and brackets', () => {
      const text = [
        '305288508 \u200Fלניסיון עוסק מורשה\u200E poy',
        '- NS \u200Fראשוני הראשונים, 1 ראשון\u200E',
        '\u200Fחשבונית מס קבלה מספר : 02/000001 העתקק\u200E',
        '00086 | \u200Fלכבוד; מספרכם:\u200E',
        '01/12/21 \u200Fישראל שם טוב תאריך:\u200E',
        '5600.00] \u200Fסה"כ לאחר הנח\u200E',
        '112200 17.00% \u200Fמע"מ\u200E',
        '\u200E72200] = \u200Fלתשלום:\u200E "ao',
      ].join('\n');
      const result = ReceiptOcrService.parseReceipt(text);
      expect(result.data.date).toBe('2021-12-01');
      expect(result.data.amount).toBeGreaterThan(0);
      expect(result.data.merchant).toBe('- NS ראשוני הראשונים, 1 ראשון');
    });
  });

  describe('parseReceipt — edge cases', () => {
    it('returns failure for empty text', () => {
      const result = ReceiptOcrService.parseReceipt('');
      expect(result.success).toBe(false);
    });

    it('handles text with no extractable fields', () => {
      const result = ReceiptOcrService.parseReceipt('Just some random text\nNo numbers here');
      expect(result.success).toBe(true);
      expect(result.data.date).toBeUndefined();
      expect(result.data.amount).toBeUndefined();
      expect(result.data.merchant).toBe('Just some random text');
    });

    it('builds memo from first 5 lines', () => {
      const result = ReceiptOcrService.parseReceipt('L1\nL2\nL3\nL4\nL5\nL6');
      expect(result.data.memo).toContain('L1');
      expect(result.data.memo).toContain('L5');
      expect(result.data.memo).not.toContain('L6');
    });

    it('handles comma-formatted amounts: 1,234.56', () => {
      const result = ReceiptOcrService.parseReceipt('Store\nסה"כ 1,234.56');
      expect(result.data.amount).toBe(1234.56);
    });

    it('findLargestAmount picks largest from multiple comma-formatted amounts on one line', () => {
      // No labeled amounts — forces fallback to findLargestAmount
      // Two comma-formatted amounts on the same line exercises the while loop body
      const text = 'Store\nItems 1,200.50 discount 2,500.75';
      const result = ReceiptOcrService.parseReceipt(text);
      expect(result.data.amount).toBe(2500.75);
    });
  });

  describe('preprocess — large image skips resize', () => {
    it('does not resize when image width >= 1500', async () => {
      const sharpMod = await import('sharp');
      const mockSharp = sharpMod.default as unknown as ReturnType<typeof vi.fn>;
      // Get the shared pipeline object returned by every sharp() call
      const pipeline = mockSharp();
      // Reset resize call history, then make metadata return a wide image
      pipeline.resize.mockClear();
      pipeline.metadata.mockResolvedValueOnce({ width: 2000 });
      const service = new ReceiptOcrService();
      await service.recognize(Buffer.from('wide-image'));
      // resize should NOT be called when width >= 1500
      expect(pipeline.resize).not.toHaveBeenCalled();
    });
  });
});
