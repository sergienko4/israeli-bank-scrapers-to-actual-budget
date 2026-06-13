/**
 * Tests for the extracted OcrParsing module. The bulk of behavioral
 * coverage lives in `tests/services/ReceiptOcrService.test.ts` (which
 * exercises the same logic via the back-compat shim) — these tests
 * lock the direct module export as a stable public seam.
 */

import { describe, it, expect } from 'vitest';

import parseReceipt from '../../../src/Services/Receipt/OcrParsing.js';

describe('OcrParsing — parseReceipt module export', () => {
  it('extracts date / amount / merchant from a minimal Israeli receipt', () => {
    const text = 'סופר-פארם\n22/03/2026\nסה"כ ₪125.50';
    const result = parseReceipt(text);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.date).toBe('2026-03-22');
    expect(result.data.amount).toBe(125.5);
    expect(result.data.merchant).toBe('סופר-פארם');
  });

  it('returns failure for empty input', () => {
    const result = parseReceipt('');
    expect(result.success).toBe(false);
  });

  it('prefers לתשלום over סה"כ when both present', () => {
    const text = 'Store\nסה"כ 100.00\nלתשלום 200.00';
    const result = parseReceipt(text);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.amount).toBe(200);
  });

  it('strips invisible RTL marks from output', () => {
    const text = '\u200FStore\u200F\n22/03/2026\n₪50';
    const result = parseReceipt(text);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.merchant).toBe('Store');
  });
});
