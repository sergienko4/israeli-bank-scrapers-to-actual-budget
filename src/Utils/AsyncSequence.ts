/**
 * Sequential async iteration helpers.
 *
 * Each helper is an async generator consumed with `for await`. Steps run
 * strictly one at a time: the next step starts only after the consumer's
 * loop body has finished with the previous result. A rejected step
 * rethrows inside the consumer's loop, and a `break` or `return` there
 * ends the sequence with no further step started.
 *
 * Unlike a recursive promise chain, a long-running sequence keeps memory
 * flat because no promise ever waits on the next one.
 *
 * Every yielded value is awaited. Yield the result of async work, and box
 * caller-supplied data that may be thenable, or it is unwrapped (and its
 * rejection thrown into the consumer's loop) before the loop body sees it.
 */
import logger from './UtilLogger.js';

/**
 * Yields `step(item)` for each item, in order, one item at a time.
 * Items appended to the array before the iteration reaches the end are
 * visited too, exactly as with a `for...of` loop over the same array.
 * @param items - The items to process.
 * @param step - Starts the async work for one item.
 * @returns The settled step results, in item order.
 */
export async function* mapInOrder<TItem, TResult>(
  items: readonly TItem[], step: (item: TItem) => Promise<TResult>
): AsyncIterable<TResult> {
  logger.debug('mapInOrder');
  for (const item of items) yield step(item);
}

/**
 * Yields `next()` for as long as `shouldContinue()` returns true.
 * The condition is re-checked after the consumer's loop body has run,
 * so state changed by that body decides whether another step starts.
 * @param shouldContinue - Returns false to end the sequence.
 * @param next - Starts one round of async work.
 * @returns The settled round results, in order.
 */
export async function* repeatWhile<TResult>(
  shouldContinue: () => boolean, next: () => Promise<TResult>
): AsyncIterable<TResult> {
  logger.debug('repeatWhile');
  while (shouldContinue()) yield next();
}
