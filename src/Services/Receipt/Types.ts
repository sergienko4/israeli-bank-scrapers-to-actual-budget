/**
 * Shared type contracts for the Receipt import sub-modules.
 *
 * Lifting these interfaces out of ReceiptImportHandler eliminates back-edges
 * from sub-modules (Payee matcher, Menu presenter, Importer) into the
 * orchestrator, keeping the dependency graph one-way.
 */

import type { IReceiptData, Procedure } from '../../Types/Index.js';

/**
 * OCR surface consumed by the receipt-import sub-modules.
 *
 * Abstracts the single instance behaviour the consumers need from
 * ReceiptOcrService, so they depend on this contract (Dependency
 * Inversion) instead of the concrete tesseract-backed implementation.
 */
export interface IReceiptOcr {
  /**
   * Recognizes text from raw image bytes.
   * @param imageBuffer - Raw image bytes (JPEG/PNG).
   * @returns Procedure with `{ text }` on success, or a typed failure.
   */
  recognize(imageBuffer: Buffer): Promise<Procedure<{ text: string }>>;
}

/** Actual Budget API surface needed by Receipt import sub-modules. */
export interface IReceiptActualApi {
  /** Fetches all accounts from Actual Budget. */
  getAccounts: () => Promise<{ id: string; name: string }[]>;
  /** Fetches all categories from Actual Budget. */
  getCategories: () => Promise<{ id: string; name: string }[]>;
  /** Imports transactions into an Actual Budget account. */
  importTransactions: (
    accountId: string,
    transactions: { account: string; date: string; [key: string]: unknown }[]
  ) => Promise<unknown>;
  /** Builds an AQL query for the given table. */
  q: (table: string) => {
    filter: (f: unknown) => {
      select: (s: string[]) => {
        orderBy: (o: unknown) => unknown;
      };
    };
  };
  /** Executes an AQL query. */
  aqlQuery: (query: unknown) => Promise<unknown>;
}

/**
 * Receipt-import conversation state shared between the handler
 * (state-machine owner) and the {@link IReceiptFlowContext} engine bridge.
 */
export interface IReceiptState {
  /** Current conversation phase. */
  phase: 'idle' | 'awaiting_photo' | 'awaiting_selection';
  /** Monotonic id used to detect and discard cancelled flows. */
  flowId: number;
  /** Parsed receipt awaiting account/category selection. */
  receipt?: IReceiptData;
  /** Account chosen for the import. */
  selectedAccount?: string;
  /** Category chosen for the import. */
  selectedCategory?: string;
  /** Active flow-timeout handle (cleared on reset). */
  timeoutHandle?: ReturnType<typeof globalThis.setTimeout>;
}

/**
 * Bridge the receipt-import engine uses to read and mutate the live
 * conversation state owned by the handler, plus reset the state machine —
 * without taking a back-edge on the orchestrator class.
 */
export interface IReceiptFlowContext {
  /** Live conversation state (read fresh and mutated in place). */
  readonly state: IReceiptState;
  /** Resets the conversation to idle and clears any active timeout. */
  reset(): void;
}
