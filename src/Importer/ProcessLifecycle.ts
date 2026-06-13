/**
 * Process-lifecycle helpers extracted from src/Index.ts.
 *
 * Owns the four shutdown / fatal-error paths that close the Actual
 * Budget API connection so the Docker container exits cleanly and the
 * Telegram webhook receives the error event instead of hanging on a
 * live API connection.
 *
 * Returns the four helpers bound to their dependencies (api, logger,
 * notification service, error formatter) so the orchestrator (and
 * tests) can pass deterministic fakes without touching globals.
 */

import api from '@actual-app/api';

import type { ErrorFormatter } from '../Errors/ErrorFormatter.js';
import type { ILogger } from '../Logger/ILogger.js';
import type { ITimeoutWrapper } from '../Resilience/TimeoutWrapper.js';
import type NotificationService from '../Services/NotificationService.js';
import type { Procedure } from '../Types/Index.js';
import { succeed } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';

/**
 * Minimal API surface ProcessLifecycle needs (Actual Budget client).
 * Declared as a structural pick of the live api default export so the
 * interface stays in lockstep with @actual-app/api without re-declaring
 * its (void-returning) shape — the project's no-void architecture rule
 * applies to authored interfaces, not to upstream types.
 */
export type IShutdownableApi = Pick<typeof api, 'shutdown'>;

/**
 * Dependencies the process-lifecycle helpers need.
 * Bundling keeps the factory under the max-params (3) cap.
 */
export interface IProcessLifecycleDeps {
  readonly logger: ILogger;
  readonly notificationService: NotificationService;
  readonly errorFormatter: ErrorFormatter;
  readonly timeoutWrapper: ITimeoutWrapper;
  /**
   * Actual Budget API handle. Optional: defaults to the live `@actual-app/api`
   * import so production callers can omit it. Tests inject a fake.
   */
  readonly api?: IShutdownableApi;
}

/**
 * Frozen handle of the four process-lifecycle functions consumed by
 * src/Index.ts and the future ImporterBootstrap.
 */
export interface IProcessLifecycle {
  /** Best-effort API shutdown that never throws. */
  readonly safeShutdown: () => Promise<Procedure<{ status: string }>>;
  /** Handles an unrecoverable error: logs it, notifies, and exits 1. */
  readonly handleFatalError: (error: unknown) => Promise<never>;
  /** Handles a pipeline-level failure (non-throw): notifies and exits 1. */
  readonly handlePipelineFailure: (failure: { readonly message: string }) => Promise<never>;
  /** Gracefully shuts down the API during process termination. */
  readonly shutdownApiGracefully: () => Promise<Procedure<{ status: string }>>;
}

/**
 * Internal resolved deps with api defaulted — every impl uses this.
 */
interface IResolvedDeps {
  readonly logger: ILogger;
  readonly notificationService: NotificationService;
  readonly errorFormatter: ErrorFormatter;
  readonly timeoutWrapper: ITimeoutWrapper;
  readonly api: IShutdownableApi;
}

/**
 * Hard cap on time spent waiting for the error-notification transport
 * (e.g. Telegram). A dying process must not hang on a transport that
 * neither resolves nor rejects (network stall, half-open TCP).
 * Per CR cycle 2 finding #1.
 */
const NOTIFY_TIMEOUT_MS = 5_000;

/**
 * Sends an error notification with a hard timeout. Always returns —
 * rejections AND timeouts are logged and swallowed so the caller can
 * proceed to shutdown unconditionally. Uses the project's TimeoutWrapper
 * (no homegrown setTimeout per the no-restricted-syntax rule).
 *
 * @param deps - The resolved lifecycle dependencies.
 * @param message - Pre-formatted error message to send.
 * @returns Procedure indicating whether notification was sent or failed.
 */
async function sendErrorWithTimeout(
  deps: IResolvedDeps,
  message: string,
): Promise<Procedure<{ status: string }>> {
  try {
    const sendPromise = deps.notificationService.sendError(message);
    await deps.timeoutWrapper.wrap(sendPromise, NOTIFY_TIMEOUT_MS, 'sendError');
    return succeed({ status: 'notification-sent' });
  } catch (notifyError: unknown) {
    deps.logger.error(`Failed to send error notification: ${errorMessage(notifyError)}`);
    return succeed({ status: 'notification-failed' });
  }
}

/**
 * Best-effort API shutdown that never throws.
 *
 * @param deps - The resolved lifecycle dependencies.
 * @returns Procedure indicating whether shutdown was clean or recovered.
 */
async function safeShutdownImpl(deps: IResolvedDeps): Promise<Procedure<{ status: string }>> {
  try {
    await deps.api.shutdown();
  } catch (error: unknown) {
    deps.logger.error(`Error during API shutdown: ${errorMessage(error)}`);
    return succeed({ status: 'api-shutdown-error' });
  }
  return succeed({ status: 'api-shutdown' });
}

/**
 * Handles an unrecoverable error: logs it, sends a Telegram notification, and exits.
 *
 * @param error - The unknown error caught at the top level.
 * @param deps - The resolved lifecycle dependencies.
 * @returns Never — always exits the process with code 1.
 */
async function handleFatalErrorImpl(
  error: unknown,
  deps: IResolvedDeps,
): Promise<never> {
  const err = error instanceof Error ? error : new Error(String(error));
  const formattedError = deps.errorFormatter.format(err);
  deps.logger.error(`\n${formattedError}`);
  if (error instanceof Error) deps.logger.error(`Stack trace: ${error.stack ?? 'N/A'}`);
  await sendErrorWithTimeout(deps, formattedError);
  await safeShutdownImpl(deps);
  process.exit(1);
}

/**
 * Handles a pipeline-level failure (e.g. all-banks-failed): notifies and exits.
 *
 * @param failure - Pipeline failure carrying the user-facing message.
 * @param failure.message - Human-readable pipeline failure message.
 * @param deps - The resolved lifecycle dependencies.
 * @returns Never — always exits the process with code 1.
 */
async function handlePipelineFailureImpl(
  failure: { readonly message: string },
  deps: IResolvedDeps,
): Promise<never> {
  deps.logger.error(`Pipeline failed: ${failure.message}`);
  await sendErrorWithTimeout(deps, failure.message);
  await safeShutdownImpl(deps);
  process.exit(1);
}

/**
 * Gracefully shuts down the Actual Budget API during process termination.
 *
 * @param deps - The resolved lifecycle dependencies.
 * @returns Procedure indicating shutdown result.
 */
async function shutdownApiGracefullyImpl(
  deps: IResolvedDeps,
): Promise<Procedure<{ status: string }>> {
  deps.logger.info('🔌 Shutting down Actual Budget API...');
  return await safeShutdownImpl(deps);
}

/**
 * Builds the four process-lifecycle helpers, each bound to the
 * supplied dependencies.
 *
 * @param deps - The shared lifecycle dependencies.
 * @returns Frozen IProcessLifecycle handle consumed by the orchestrator.
 */
export function buildProcessLifecycle(deps: IProcessLifecycleDeps): IProcessLifecycle {
  const resolved: IResolvedDeps = {
    logger: deps.logger,
    notificationService: deps.notificationService,
    errorFormatter: deps.errorFormatter,
    timeoutWrapper: deps.timeoutWrapper,
    api: deps.api ?? api,
  };
  return Object.freeze({
    /**
     * Bound safe-shutdown closure.
     * @returns Procedure indicating whether shutdown was clean or recovered.
     */
    safeShutdown: () => safeShutdownImpl(resolved),
    /**
     * Bound fatal-error handler.
     * @param error - The unknown error caught at the top level.
     * @returns Never — always exits the process with code 1.
     */
    handleFatalError: (error: unknown) => handleFatalErrorImpl(error, resolved),
    /**
     * Bound pipeline-failure handler.
     * @param failure - Pipeline failure carrying the user-facing message.
     * @param failure.message - Human-readable pipeline failure message.
     * @returns Never — always exits the process with code 1.
     */
    handlePipelineFailure: (failure: { readonly message: string }) =>
      handlePipelineFailureImpl(failure, resolved),
    /**
     * Bound graceful-shutdown closure registered with the shutdown handler.
     * @returns Procedure indicating shutdown result.
     */
    shutdownApiGracefully: () => shutdownApiGracefullyImpl(resolved),
  });
}
