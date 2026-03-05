/**
 * Stage 3 class method decorator for automated execution tracing.
 * Logs the method name at INFO level on every invocation.
 * Note: args are intentionally NOT logged to avoid exposing bank credentials or OTP tokens.
 */
import { getLogger } from '../Logger/Index.js';

type BoundMethod<This, Args extends unknown[], Return> =
  (this: This, ...args: Args) => Return;

/**
 * Wraps a class method to log its name at INFO level before each call.
 * @param target - The original method to wrap.
 * @param context - The decorator context providing the method name.
 * @returns A wrapped method that logs execution and delegates to the original.
 */
export function Loggable<This, Args extends unknown[], Return>(
  target: BoundMethod<This, Args, Return>,
  context: ClassMethodDecoratorContext<This, BoundMethod<This, Args, Return>>
): BoundMethod<This, Args, Return> {
  const label = `[EXEC] ${String(context.name)}`;
  return function (this: This, ...args: Args): Return {
    const logger = getLogger();
    logger.info(label);
    return Reflect.apply(target, this, args);
  };
}
