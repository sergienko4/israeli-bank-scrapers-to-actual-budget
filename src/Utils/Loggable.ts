/**
 * @Loggable — Stage 3 class method decorator for automated execution tracing.
 * Logs the method name at INFO level on every invocation.
 * Note: args are intentionally NOT logged to avoid exposing bank credentials or OTP tokens.
 */
import { getLogger } from '../Logger/index.js';

type BoundMethod<This, Args extends unknown[], Return> =
  (this: This, ...args: Args) => Return;

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
