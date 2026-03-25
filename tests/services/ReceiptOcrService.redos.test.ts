/**
 * ReDoS (Regular Expression Denial of Service) tests for ReceiptOcrService.
 * Verifies that all regex patterns complete in bounded time on adversarial input.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ReceiptOcrService from '../../src/Services/ReceiptOcrService.js';

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
    recognize: vi.fn().mockResolvedValue({ data: { text: 'mock' } }),
    terminate: vi.fn(),
  }),
}));

vi.mock('../../src/Logger/Index.js', () => ({
  getLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  createLogger: vi.fn(),
  deriveLogFormat: vi.fn().mockReturnValue('words'),
}));

const LONG_DIGITS = '9'.repeat(10000);
const LONG_TEXT = 'a'.repeat(10000);
const MAX_MS = 100;

describe('ReceiptOcrService — ReDoS resistance', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('parseReceipt handles 10K digit string without backtracking', () => {
    const start = performance.now();
    ReceiptOcrService.parseReceipt(LONG_DIGITS);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(MAX_MS);
  });

  it('parseReceipt handles 10K char string without backtracking', () => {
    const start = performance.now();
    ReceiptOcrService.parseReceipt(LONG_TEXT);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(MAX_MS);
  });

  it('parseReceipt handles repeated dot-digit pattern', () => {
    const adversarial = '1.1.1.1.1.1.1.1.1.1.'.repeat(500);
    const start = performance.now();
    ReceiptOcrService.parseReceipt(adversarial);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(MAX_MS);
  });

  it('parseReceipt handles long line with לכבוד', () => {
    const longLine = 'x'.repeat(5000) + 'לכבוד: test name';
    const start = performance.now();
    ReceiptOcrService.parseReceipt(longLine);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(MAX_MS);
  });

  it('parseReceipt handles repeated shekel symbol', () => {
    const adversarial = '₪'.repeat(5000) + '123.45';
    const start = performance.now();
    ReceiptOcrService.parseReceipt(adversarial);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(MAX_MS);
  });

  it('parseReceipt handles mixed commas and dots', () => {
    const adversarial = '1,2.3,4.5,6.7,8.9,0.'.repeat(500);
    const start = performance.now();
    ReceiptOcrService.parseReceipt(adversarial);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(MAX_MS);
  });
});
