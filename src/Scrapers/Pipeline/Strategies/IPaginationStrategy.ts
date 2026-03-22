/**
 * Generic pagination strategy interface.
 * Processes items sequentially with shutdown checks and optional delays.
 */

import type { IPipelineContext, Procedure } from '../Index.js';

/** Strategy for processing a collection of items sequentially. */
export interface IPaginationStrategy<TItem, TResult> {
  /**
   * Processes items one at a time, collecting results.
   * @param items - Readonly array of items to process.
   * @param processor - Async function to process each item.
   * @param ctx - Pipeline context for shutdown checks and logging.
   * @returns Procedure with collected results or failure.
   */
  paginate(
    items: readonly TItem[],
    processor: (item: TItem) => Promise<Procedure<TResult>>,
    ctx: IPipelineContext
  ): Promise<Procedure<readonly TResult[]>>;
}
