/**
 * Stage 3 class method decorator for automated execution tracing.
 * Logs the method name at INFO level on every invocation.
 * Note: args are intentionally NOT logged to avoid exposing bank credentials or OTP tokens.
 */
import { getLogger } from '../Logger/Index.js';

/** A bound class method signature used by the loggable decorator. */
export type BoundMethod<TThis, TArgs extends unknown[], TReturn> =
  (this: TThis, ...args: TArgs) => TReturn;

/**
 * Wraps a class method to log its name at INFO level before each call.
 * @param target - The original method to wrap.
 * @param context - The decorator context providing the method name.
 * @returns A wrapped method that logs execution and delegates to the original.
 */
export function loggable<TThis, TArgs extends unknown[], TReturn>(
  target: BoundMethod<TThis, TArgs, TReturn>,
  context: ClassMethodDecoratorContext<TThis, BoundMethod<TThis, TArgs, TReturn>>
): BoundMethod<TThis, TArgs, TReturn> {
  const label = `[EXEC] ${String(context.name)}`;
  return function (this: TThis, ...args: TArgs): TReturn {
    const logger = getLogger();
    logger.info(label);
    return Reflect.apply(target, this, args);
  };
}
