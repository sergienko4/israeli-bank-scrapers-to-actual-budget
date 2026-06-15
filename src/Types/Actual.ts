/**
 * Actual Budget server connection settings and account shapes.
 */

/** Connection and budget settings for the Actual Budget server. */
export interface IActualConfig {
  init: {
    /** Local directory for cached budget data. */
    dataDir: string;
    /** URL of the Actual Budget server (e.g. `http://actual_server:5006`). */
    serverURL: string;
    /** Actual Budget server password. */
    password: string;
  };
  budget: {
    /** UUID of the budget to sync (found in Actual Budget → Settings). */
    syncId: string;
    /** Optional password for an encrypted budget. */
    password: string | null;
  };
}

/** Matches @actual-app/api's APIAccountEntity shape */
export interface IActualAccount {
  id: string;
  name: string;
  offbudget?: boolean;
  closed?: boolean;
}
