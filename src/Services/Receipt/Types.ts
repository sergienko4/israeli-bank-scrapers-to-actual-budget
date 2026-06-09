/**
 * Shared type contracts for the Receipt import sub-modules.
 *
 * Lifting these interfaces out of ReceiptImportHandler eliminates back-edges
 * from sub-modules (Payee matcher, Menu presenter, Importer) into the
 * orchestrator, keeping the dependency graph one-way.
 */

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
