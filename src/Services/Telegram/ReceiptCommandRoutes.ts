/**
 * ReceiptCommandRoutes — declarative table of the 5 receipt_* callbacks.
 * Returns an empty array when no ReceiptImportHandler is configured.
 */

import type { Procedure } from '../../Types/Index.js';
import { succeed } from '../../Types/Index.js';
import type { ReceiptImportHandler } from '../ReceiptImportHandler.js';
import type { CommandHandler, ICommandRoute } from './ICommandRoute.js';
import { makeExactRoute, makePrefixRoute } from './ICommandRoute.js';

const ACC_PREFIX = 'receipt_acc:';
const CAT_PREFIX = 'receipt_cat:';
const MISSING_PAYLOAD_STATUS = 'missing-payload';

/**
 * Wraps a payload-required handler so empty payloads short-circuit to
 * `missing-payload` instead of invoking the receipt handler with `''`.
 * @param fn - Handler that requires a non-empty id payload.
 * @returns CommandHandler that guards against empty payloads.
 */
function requirePayload(
  fn: (id: string) => Promise<Procedure<{ status: string }>>,
): CommandHandler {
  return async (arg: string) => {
    if (arg === '') return succeed({ status: MISSING_PAYLOAD_STATUS });
    return await fn(arg);
  };
}

/**
 * Builds the receipt-callback route table.
 * @param receiptHandler - Optional ReceiptImportHandler instance.
 * @returns Frozen ordered array of receipt routes (empty when handler absent).
 */
export default function buildReceiptCommandRoutes(
  receiptHandler?: ReceiptImportHandler,
): readonly ICommandRoute[] {
  if (!receiptHandler) return Object.freeze<ICommandRoute[]>([]);
  const accHandler = requirePayload(
    async (id) => await receiptHandler.onAccountSelected(id),
  );
  const catHandler = requirePayload(
    async (id) => await receiptHandler.onCategorySelected(id),
  );
  const routes: ICommandRoute[] = [
    makeExactRoute('receipt_confirm', async () => await receiptHandler.onConfirm()),
    makeExactRoute('receipt_choose', async () => await receiptHandler.onChooseDifferent()),
    makeExactRoute('receipt_cancel', async () => await receiptHandler.onCancel()),
    makePrefixRoute(ACC_PREFIX, accHandler),
    makePrefixRoute(CAT_PREFIX, catHandler),
  ];
  return Object.freeze(routes);
}
