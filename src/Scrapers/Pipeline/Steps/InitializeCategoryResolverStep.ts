/**
 * Pipeline step: Initialize the category resolver if configured and not in dry-run mode.
 */

import type {
  IPipelineContext,
  IServiceContainer,
  PipelineStep,
  Procedure,
} from '../Index.js';
import { isFail, succeed } from '../Index.js';

/** The resolved (non-false) category resolver type. */
type ICategoryResolver = Exclude<
  IServiceContainer['categoryResolver'],
  false
>;

/**
 * Creates a step that initializes the category resolver.
 * Skips initialization in dry-run mode or when no resolver is configured.
 * @returns PipelineStep that initializes the resolver.
 */
export default function createInitializeCategoryResolverStep(): PipelineStep {
  /**
   * Inner step that initializes the category resolver.
   * @param ctx - Pipeline context for this step.
   * @returns Procedure with resolver readiness state.
   */
  return async (ctx: IPipelineContext): ReturnType<PipelineStep> => {
    if (ctx.state.isDryRun) {
      return resolverReady(ctx);
    }
    if (!ctx.services.categoryResolver) {
      return resolverReady(ctx);
    }

    return attemptInit(ctx, ctx.services.categoryResolver);
  };
}

/**
 * Returns a result indicating the resolver is ready (or skipped).
 * @param ctx - Pipeline context.
 * @returns Successful Procedure with resolverReady true.
 */
function resolverReady(
  ctx: IPipelineContext
): Procedure<IPipelineContext> {
  return succeed({
    ...ctx,
    state: { ...ctx.state, resolverReady: true },
  });
}

/**
 * Attempts to initialize the category resolver.
 * @param ctx - Pipeline context with resolver service.
 * @param resolver - The narrowed category resolver.
 * @returns Procedure with resolver readiness state.
 */
async function attemptInit(
  ctx: IPipelineContext,
  resolver: ICategoryResolver
): ReturnType<PipelineStep> {
  ctx.logger.info('Loading category resolver...');
  const result = await resolver.initialize();
  if (isFail(result)) {
    ctx.logger.warn(
      `Category resolver init failed: ${result.message}`
    );
  }
  return resolverReady(ctx);
}
