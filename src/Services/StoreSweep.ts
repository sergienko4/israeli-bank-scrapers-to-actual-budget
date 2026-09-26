/**
 * Sweeps the staging leftovers of the runtime stores when a process starts.
 *
 * <p>A write killed between staging and rename leaves its staged file
 * behind, and only a sweep removes it ({@link SecureJsonStore} asks the owner
 * of the process lifecycle to run one). This is housekeeping: a failure is a
 * warning, never an error, and one store's failure does not keep the others
 * from being swept. A missing directory means nothing was ever staged there.
 */

import type { ILogger } from '../Logger/ILogger.js';
import type { ISweepReport } from '../Storage/StoreTypes.js';
import type { Procedure } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';

/** A store that can delete the staged files a killed write left behind. */
export interface ISweepableStore {
  sweepStagedLeftovers(): Procedure<ISweepReport>;
}

/** One store to sweep, and what log lines call it. */
export interface ISweepTarget {
  /** What the store is called in log lines, e.g. `OTP settings`. */
  readonly label: string;
  /** Opens the store at its configured path. */
  readonly open: () => ISweepableStore;
}

/**
 * Warns that one store could not be swept.
 * @param target - The store that was not swept.
 * @param logger - Where the warning goes.
 * @param cause - Why it was not swept.
 * @returns False, so the caller counts it as not swept.
 */
function warnNotSwept(target: ISweepTarget, logger: ILogger, cause: string): false {
  logger.warn(`Could not sweep staged ${target.label} files: ${cause}`);
  return false;
}

/**
 * Reports one store's sweep.
 * @param target - The store that was swept.
 * @param logger - Where the report goes.
 * @param swept - What its sweep reported.
 * @returns True when the sweep ran, or found no directory to sweep.
 */
function reportSweep(
  target: ISweepTarget, logger: ILogger, swept: Procedure<ISweepReport>,
): boolean {
  if (!swept.success) {
    if (swept.status === 'ENOENT') return true;
    return warnNotSwept(target, logger, swept.message);
  }
  if (swept.data.removedCount > 0) {
    logger.info(`  🧹 ${swept.data.summary} beside the ${target.label}`);
  }
  return true;
}

/**
 * Sweeps one store, turning any failure into a warning.
 * @param target - The store to sweep.
 * @param logger - Where reports and warnings go.
 * @returns True when the sweep ran, or found no directory to sweep.
 */
function sweepOne(target: ISweepTarget, logger: ILogger): boolean {
  try {
    const store = target.open();
    const swept = store.sweepStagedLeftovers();
    return reportSweep(target, logger, swept);
  } catch (error: unknown) {
    const cause = errorMessage(error);
    return warnNotSwept(target, logger, cause);
  }
}

/**
 * Sweeps each store's staging leftovers, in order.
 * @param targets - The stores to sweep.
 * @param logger - Where reports and warnings go.
 * @returns How many stores were swept without a warning.
 */
export default function sweepStores(targets: readonly ISweepTarget[], logger: ILogger): number {
  let sweptCount = 0;
  for (const target of targets) {
    if (sweepOne(target, logger)) sweptCount += 1;
  }
  return sweptCount;
}
