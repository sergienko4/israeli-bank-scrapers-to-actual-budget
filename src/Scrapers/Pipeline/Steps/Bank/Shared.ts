/**
 * Shared per-bank types + stage labels used by the 3-stage Bank cluster.
 *
 * Extracted from ProcessAllBanksStep.ts as part of the PR 15 split so
 * ScrapeStage / MapStage / ImportStage can depend on a single, narrow
 * shared module instead of importing each other or back into the
 * orchestrator. Keeps the cluster acyclic.
 */

import type { IBankConfig, IBankQuarantineStage, IPipelineContext } from '../../Index.js';

/** Stage label for the scrape step (used as Procedure.status on fail). */
export const STAGE_SCRAPE: IBankQuarantineStage = 'scrape';
/** Stage label for the legacy→canonical mapping step. */
export const STAGE_MAP: IBankQuarantineStage = 'map';
/** Stage label for the AccountImporter step. */
export const STAGE_IMPORT: IBankQuarantineStage = 'import';

const STAGE_LOOKUP: Record<string, IBankQuarantineStage> = {
  scrape: STAGE_SCRAPE,
  map: STAGE_MAP,
  import: STAGE_IMPORT,
};

/**
 * Maps a failure status string to a quarantine stage label.
 *
 * Defaults to 'import' so unknown failure surfaces land in the most
 * specific bucket (import is the terminal stage; mis-stamped failures
 * there are easier to triage than mis-stamped scrape/map failures).
 * @param status - Status carried on the failed Procedure.
 * @returns Canonical IBankQuarantineStage (defaults to 'import').
 */
export function stageFromStatus(status: string): IBankQuarantineStage {
  return STAGE_LOOKUP[status] ?? STAGE_IMPORT;
}

/** Bank entry pulled from config after filter (also used by orchestrator). */
export interface IBankEntry {
  readonly bankName: string;
  readonly bankConfig: IBankConfig;
}

/** Shared per-bank opts threaded through scrape→map→import. */
export interface IBankOpts {
  readonly entry: IBankEntry;
  readonly ctx: IPipelineContext;
  readonly start: number;
}
