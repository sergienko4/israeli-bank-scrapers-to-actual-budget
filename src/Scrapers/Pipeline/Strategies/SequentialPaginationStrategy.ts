/**
 * Sequential pagination strategy -- processes items one at a time.
 * Checks for shutdown between items. Supports optional pause.
 */

import type { IPipelineContext, Procedure } from '../Index.js';
import { fail, isFail, succeed } from '../Index.js';
import type { IPaginationStrategy } from './IPaginationStrategy.js';

/** Options for sequential pagination. */
export interface ISequentialOptions {
  readonly pauseMs: number;
}

/** Internal state passed between recursive calls. */
interface IProcessState<TItem, TResult> {
  readonly items: readonly TItem[];
  readonly processor: (
    item: TItem
  ) => Promise<Procedure<TResult>>;
  readonly ctx: IPipelineContext;
  readonly options: ISequentialOptions;
}

/**
 * Creates a sequential pagination strategy with optional pause between items.
 * @param options - Configuration including pause between items.
 * @param options.pauseMs - Milliseconds to pause between items.
 * @returns An IPaginationStrategy that processes items sequentially.
 */
export default function createSequentialStrategy<TItem, TResult>(
  options: ISequentialOptions
): IPaginationStrategy<TItem, TResult> {
  const strategy: IPaginationStrategy<TItem, TResult> = {
    paginate: buildPaginateFn<TItem, TResult>(options),
  };
  return strategy;
}

/**
 * Builds the paginate function that captures the given options.
 * @param options - Sequential pagination options.
 * @returns A paginate function for the strategy.
 */
function buildPaginateFn<TItem, TResult>(
  options: ISequentialOptions
): IPaginationStrategy<TItem, TResult>['paginate'] {
  /**
   * Processes all items sequentially with shutdown checks.
   * @param items - Items to process.
   * @param processor - Async processor for each item.
   * @param ctx - Pipeline context for shutdown checks.
   * @returns Procedure with all results.
   */
  return (
    items: readonly TItem[],
    processor: (item: TItem) => Promise<Procedure<TResult>>,
    ctx: IPipelineContext
  ): Promise<Procedure<readonly TResult[]>> => {
    return processAt(
      { items, processor, ctx, options }, 0, []
    );
  };
}

/**
 * Recursively processes one item at the given index.
 * @param state - Shared processing state with items and processor.
 * @param index - Current index in the items array.
 * @param results - Accumulated results so far.
 * @returns Procedure with all results or failure.
 */
async function processAt<TItem, TResult>(
  state: IProcessState<TItem, TResult>,
  index: number,
  results: readonly TResult[]
): Promise<Procedure<readonly TResult[]>> {
  if (index >= state.items.length) {
    return succeed([...results], 'all-processed');
  }
  if (state.ctx.shutdownHandler.isShuttingDown()) {
    return shutdownAbort('shutdown requested');
  }
  const pauseCheck = await pauseIfNeeded(state, index);
  if (isFail(pauseCheck)) {
    return pauseCheck;
  }
  return processItem(state, index, results);
}

/**
 * Returns a shutdown-abort failure result.
 * @param reason - Description of why shutdown was triggered.
 * @returns Failure procedure with shutdown status.
 */
function shutdownAbort(
  reason: string
): Procedure<readonly never[]> {
  return fail(
    `Pagination aborted: ${reason}`,
    { status: 'shutdown' }
  );
}

/**
 * Pauses between items and checks for shutdown after pause.
 * @param state - Shared processing state.
 * @param index - Current item index.
 * @returns Success if no shutdown, failure if aborted.
 */
async function pauseIfNeeded<TItem, TResult>(
  state: IProcessState<TItem, TResult>,
  index: number
): Promise<Procedure<boolean>> {
  if (index <= 0 || state.options.pauseMs <= 0) {
    return succeed(false, 'no-pause-needed');
  }
  await waitForDuration(state.options.pauseMs);
  if (state.ctx.shutdownHandler.isShuttingDown()) {
    return fail(
      'Pagination aborted: shutdown requested after pause',
      { status: 'shutdown' }
    );
  }
  return succeed(true, 'pause-complete');
}

/**
 * Processes a single item and recurses to the next index.
 * @param state - Shared processing state.
 * @param index - Current item index.
 * @param results - Accumulated results so far.
 * @returns Procedure with all results or failure.
 */
async function processItem<TItem, TResult>(
  state: IProcessState<TItem, TResult>,
  index: number,
  results: readonly TResult[]
): Promise<Procedure<readonly TResult[]>> {
  const result = await state.processor(state.items[index]);
  if (isFail(result)) {
    state.ctx.logger.warn(
      `Item ${String(index)} failed: ${result.message}`
    );
    return processAt(state, index + 1, results);
  }

  return processAt(
    state,
    index + 1,
    [...results, result.data]
  );
}

/**
 * Creates a timer promise that resolves after the given ms.
 * @param ms - Milliseconds to wait.
 * @returns Promise that resolves to true after the duration.
 */
function createTimerPromise(
  ms: number
): Promise<boolean> {
  return new Promise<boolean>(
    /**
     * Executor that schedules the resolve callback.
     * @param resolve - Promise resolve function.
     * @returns The timer ID from setTimeout.
     */
    (resolve): ReturnType<typeof globalThis.setTimeout> => {
      return globalThis.setTimeout(
        /**
         * Timer callback that resolves the promise.
         * @returns True after resolving.
         */
        (): boolean => {
          resolve(true);
          return true;
        },
        ms
      );
    }
  );
}

/**
 * Pauses execution for the given duration using a timer.
 * @param ms - Milliseconds to wait.
 * @returns Procedure indicating the pause completed.
 */
async function waitForDuration(
  ms: number
): Promise<Procedure<boolean>> {
  await createTimerPromise(ms);
  return succeed(true, 'pause-complete');
}
