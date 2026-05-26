import { describe, expect, it, vi } from 'vitest';

import type { ReceiptImportHandler } from '../../../src/Services/ReceiptImportHandler.js';
import buildReceiptCommandRoutes from '../../../src/Services/Telegram/ReceiptCommandRoutes.js';
import { succeed } from '../../../src/Types/Index.js';

/**
 * Builds a stub ReceiptImportHandler with all 5 callback handlers as spies.
 * @returns Stub cast to ReceiptImportHandler.
 */
function stubReceiptHandler(): ReceiptImportHandler {
  return {
    onConfirm: vi.fn().mockResolvedValue(succeed({ status: 'confirm' })),
    onChooseDifferent: vi.fn().mockResolvedValue(succeed({ status: 'choose' })),
    onCancel: vi.fn().mockResolvedValue(succeed({ status: 'cancel' })),
    onAccountSelected: vi.fn().mockResolvedValue(succeed({ status: 'acc' })),
    onCategorySelected: vi.fn().mockResolvedValue(succeed({ status: 'cat' })),
  } as unknown as ReceiptImportHandler;
}

describe('buildReceiptCommandRoutes', () => {
  it('returns an empty array when no receiptHandler is provided', () => {
    expect(buildReceiptCommandRoutes(undefined)).toEqual([]);
  });

  it('produces 5 routes when receiptHandler is provided', () => {
    const routes = buildReceiptCommandRoutes(stubReceiptHandler());
    expect(routes.length).toBe(5);
  });

  it('registers the documented patterns and match modes', () => {
    const routes = buildReceiptCommandRoutes(stubReceiptHandler());
    expect(routes.map(r => r.pattern)).toEqual([
      'receipt_confirm', 'receipt_choose', 'receipt_cancel',
      'receipt_acc:', 'receipt_cat:',
    ]);
    expect(routes.map(r => r.match)).toEqual([
      'exact', 'exact', 'exact', 'prefix', 'prefix',
    ]);
  });

  it('receipt_confirm dispatches to onConfirm', async () => {
    const rh = stubReceiptHandler();
    const route = buildReceiptCommandRoutes(rh).find(r => r.pattern === 'receipt_confirm')!;
    await route.handle('');
    expect(rh.onConfirm).toHaveBeenCalledOnce();
  });

  it('receipt_choose dispatches to onChooseDifferent', async () => {
    const rh = stubReceiptHandler();
    const route = buildReceiptCommandRoutes(rh).find(r => r.pattern === 'receipt_choose')!;
    await route.handle('');
    expect(rh.onChooseDifferent).toHaveBeenCalledOnce();
  });

  it('receipt_cancel dispatches to onCancel', async () => {
    const rh = stubReceiptHandler();
    const route = buildReceiptCommandRoutes(rh).find(r => r.pattern === 'receipt_cancel')!;
    await route.handle('');
    expect(rh.onCancel).toHaveBeenCalledOnce();
  });

  it('receipt_acc: extracts payload "abc" and forwards to onAccountSelected', async () => {
    const rh = stubReceiptHandler();
    const route = buildReceiptCommandRoutes(rh).find(r => r.pattern === 'receipt_acc:')!;
    expect(route.parse?.('receipt_acc:abc')).toBe('abc');
    await route.handle('abc');
    expect(rh.onAccountSelected).toHaveBeenCalledWith('abc');
  });

  it('receipt_cat: extracts payload and forwards to onCategorySelected', async () => {
    const rh = stubReceiptHandler();
    const route = buildReceiptCommandRoutes(rh).find(r => r.pattern === 'receipt_cat:')!;
    expect(route.parse?.('receipt_cat:xyz')).toBe('xyz');
    await route.handle('xyz');
    expect(rh.onCategorySelected).toHaveBeenCalledWith('xyz');
  });

  it('receipt_acc: with missing payload returns missing-payload status', async () => {
    const rh = stubReceiptHandler();
    const route = buildReceiptCommandRoutes(rh).find(r => r.pattern === 'receipt_acc:')!;
    const out = await route.handle('');
    expect(out.data.status).toBe('missing-payload');
    expect(rh.onAccountSelected).not.toHaveBeenCalled();
  });
});
