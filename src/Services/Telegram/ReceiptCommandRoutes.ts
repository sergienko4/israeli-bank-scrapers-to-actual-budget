/**
 * ReceiptCommandRoutes — declarative table of the 5 receipt_* callbacks.
 * Returns an empty array when no ReceiptImportHandler is configured.
 */

import type { Procedure } from '../../Types/Index.js';
import { succeed } from '../../Types/Index.js';
import type { ReceiptImportHandler } from '../ReceiptImportHandler.js';
import { extractPrefixPayload } from './CommandCallbackParser.js';
import type { ICommandRoute } from './ICommandRoute.js';

const ACC_PREFIX = 'receipt_acc:';
const CAT_PREFIX = 'receipt_cat:';
const MISSING_PAYLOAD_STATUS = 'missing-payload';

/**
 * Builds the receipt-callback route table.
 * @param receiptHandler - Optional ReceiptImportHandler instance.
 * @returns Frozen ordered array of receipt routes (empty when handler absent).
 */
export default function buildReceiptCommandRoutes(
  receiptHandler?: ReceiptImportHandler,
): readonly ICommandRoute<unknown>[] {
  if (!receiptHandler) return Object.freeze<ICommandRoute<unknown>[]>([]);
  const routes: ICommandRoute<unknown>[] = [
    exact('receipt_confirm', async () => await receiptHandler.onConfirm()),
    exact('receipt_choose', async () => await receiptHandler.onChooseDifferent()),
    exact('receipt_cancel', async () => await receiptHandler.onCancel()),
    prefixRoute(ACC_PREFIX, async (id) => await receiptHandler.onAccountSelected(id)),
    prefixRoute(CAT_PREFIX, async (id) => await receiptHandler.onCategorySelected(id)),
  ];
  return Object.freeze(routes);
}

/**
 * Builds an exact-match receipt route.
 * @param pattern - Exact callback literal.
 * @param fn - Handler invoked when the callback matches.
 * @returns Frozen ICommandRoute entry.
 */
function exact(
  pattern: string,
  fn: () => Promise<Procedure<{ status: string }>>,
): ICommandRoute<unknown> {
  return Object.freeze({
    match: 'exact' as const,
    pattern,
    /**
     * Invokes the bound handler, ignoring arg/ctx.
     * @returns Procedure result from the receipt handler.
     */
    handle: async (): Promise<Procedure<{ status: string }>> => await fn(),
  });
}

/**
 * Builds a prefix-match receipt route with payload extraction.
 * @param prefix - Literal prefix (e.g. `receipt_acc:`).
 * @param fn - Handler invoked with the extracted id payload.
 * @returns Frozen ICommandRoute entry.
 */
function prefixRoute(
  prefix: string,
  fn: (id: string) => Promise<Procedure<{ status: string }>>,
): ICommandRoute<unknown> {
  return Object.freeze({
    match: 'prefix' as const,
    pattern: prefix,
    /**
     * Extracts the id payload after the prefix.
     * @param raw - Trimmed raw callback string.
     * @returns The payload, or '' when missing.
     */
    parse: (raw: string): string => extractPrefixPayload(raw, prefix),
    /**
     * Forwards the extracted id to the receipt handler.
     * Returns `missing-payload` when the prefix was supplied without an id.
     * @param arg - Extracted id payload.
     * @returns Procedure carrying the receipt handler's status.
     */
    handle: async (arg: string) => {
      if (arg === '') return succeed({ status: MISSING_PAYLOAD_STATUS });
      return await fn(arg);
    },
  });
}
