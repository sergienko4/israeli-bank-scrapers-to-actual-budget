/**
 * Process-lifecycle helpers extracted from SchedulerBootstrap.ts.
 *
 * Owns every `process.exit(N)` call in the scheduler path and the
 * logger lines that immediately precede them. The orchestrator
 * (SchedulerBootstrap) becomes pure wiring with zero direct
 * `process.exit` calls — tests can stub these helpers without
 * touching the real `process` global.
 *
 * Mirrors `src/Importer/ProcessLifecycle.ts` (PR #430) at the
 * sub-tree level so future Scheduler/* extractions follow the
 * same convention.
 */

import type { ILogger } from '../../Logger/ILogger.js';
import { getLogger } from '../../Logger/Index.js';
import { errorMessage } from '../../Utils/Index.js';

/**
 * Minimal subset of `process` the lifecycle helpers depend on.
 * Bundling keeps each helper under the max-params (3) cap and
 * lets tests inject a fake without monkey-patching the global.
 */
export interface IExitable {
  readonly exit: (code: number) => never;
}

/**
 * Dependencies shared by every lifecycle helper.
 * Defaults wired in the factory so production callers can omit.
 */
export interface ISchedulerProcessLifecycleDeps {
  readonly logger?: ILogger;
  readonly exitable?: IExitable;
}

/**
 * Frozen handle of the four scheduler exit paths.
 */
export interface ISchedulerProcessLifecycle {
  /** Exits 1 if `failureCount > 0`, otherwise exits 0. */
  readonly exitOnImportResult: (result: { readonly failureCount: number }) => never;
  /** Logs the invalid-schedule message + an example line, then exits 1. */
  readonly exitOnInvalidSchedule: (reason: string) => never;
  /** Logs the fatal error (with prefix), then exits 1. */
  readonly exitOnFatalError: (error: unknown) => never;
  /** Exits 0 — no logging. */
  readonly exitClean: () => never;
}

interface IResolvedDeps {
  readonly logger: ILogger;
  readonly exitable: IExitable;
}

/**
 * Default `IExitable` that forwards to the real `process.exit`.
 * Extracted to a module constant so `resolveDeps` stays small and
 * the nested object-literal JSDoc noise is avoided.
 */
const DEFAULT_EXITABLE: IExitable = {
  /**
   * Forwards to `process.exit(code)` and is typed as `never`.
   *
   * @param code - Numeric exit code passed through to the live `process.exit`.
   * @returns Never — terminates the process.
   */
  exit: (code: number): never => process.exit(code),
};

/**
 * Merges caller-supplied overrides with sensible defaults
 * (live `getLogger()` and a thin wrapper around `process.exit`).
 *
 * @param deps - Optional caller-supplied overrides.
 * @returns Resolved dependency bundle used by every helper.
 */
function resolveDeps(deps?: ISchedulerProcessLifecycleDeps): IResolvedDeps {
  return {
    logger: deps?.logger ?? getLogger(),
    exitable: deps?.exitable ?? DEFAULT_EXITABLE,
  };
}

/**
 * Maps an import-batch result to the matching exit code (1 if any failed, else 0).
 *
 * @param result - Batch result carrying the failure count.
 * @param result.failureCount - Number of banks whose import failed in this batch.
 * @param deps - Resolved lifecycle dependencies.
 * @returns Never — always exits the process.
 */
function exitOnImportResultImpl(
  result: { readonly failureCount: number },
  deps: IResolvedDeps,
): never {
  return deps.exitable.exit(result.failureCount > 0 ? 1 : 0);
}

/**
 * Logs the invalid-schedule reason + an example, then exits 1.
 *
 * @param reason - Human-readable validation failure message.
 * @param deps - Resolved lifecycle dependencies.
 * @returns Never — always exits the process with code 1.
 */
function exitOnInvalidScheduleImpl(reason: string, deps: IResolvedDeps): never {
  deps.logger.error(`❌ ${reason}`);
  deps.logger.error('   Example: "0 */8 * * *" (every 8 hours)');
  return deps.exitable.exit(1);
}

/**
 * Logs a fatal error with a recognisable prefix, then exits 1.
 *
 * @param error - The unknown error caught by the orchestrator.
 * @param deps - Resolved lifecycle dependencies.
 * @returns Never — always exits the process with code 1.
 */
function exitOnFatalErrorImpl(error: unknown, deps: IResolvedDeps): never {
  deps.logger.error(`❌ Fatal error: ${errorMessage(error)}`);
  return deps.exitable.exit(1);
}

/**
 * Binds the four exit helpers to resolved dependencies.
 *
 * @param resolved - Bundle of logger + exitable used by every helper.
 * @returns Plain (unfrozen) handle ready for Object.freeze.
 */
function bindHelpers(resolved: IResolvedDeps): ISchedulerProcessLifecycle {
  return {
    /**
     * Bound import-result exit closure.
     *
     * @param result - Batch result carrying the failure count.
     * @param result.failureCount - Number of banks whose import failed in this batch.
     * @returns Never — always exits the process.
     */
    exitOnImportResult: (result: { readonly failureCount: number }): never =>
      exitOnImportResultImpl(result, resolved),
    /**
     * Bound invalid-schedule exit closure.
     *
     * @param reason - Human-readable validation failure message.
     * @returns Never — always exits the process with code 1.
     */
    exitOnInvalidSchedule: (reason: string): never =>
      exitOnInvalidScheduleImpl(reason, resolved),
    /**
     * Bound fatal-error exit closure.
     *
     * @param error - The unknown error caught by the orchestrator.
     * @returns Never — always exits the process with code 1.
     */
    exitOnFatalError: (error: unknown): never => exitOnFatalErrorImpl(error, resolved),
    /**
     * Bound clean-exit closure (always code 0, no logging).
     *
     * @returns Never — always exits the process with code 0.
     */
    exitClean: (): never => resolved.exitable.exit(0),
  };
}

/**
 * Builds the four scheduler-process-lifecycle helpers bound to deps.
 *
 * @param deps - Optional overrides (logger / exitable). Production omits.
 * @returns Frozen handle consumed by SchedulerBootstrap.
 */
export function buildSchedulerProcessLifecycle(
  deps?: ISchedulerProcessLifecycleDeps,
): ISchedulerProcessLifecycle {
  const resolved = resolveDeps(deps);
  const helpers = bindHelpers(resolved);
  return Object.freeze(helpers);
}
