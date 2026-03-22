/**
 * PipelineRunner — executes a sequence of named steps, threading immutable context.
 * Short-circuits on failure. Checks shutdown between steps.
 */

import type { Procedure } from '../../../Types/Index.js';
import { fail, isFail, succeed } from '../../../Types/Index.js';
import type { IPipelineContext } from '../Types/PipelineContext.js';
import type { INamedStep } from '../Types/PipelineStep.js';

/**
 * Executes pipeline steps sequentially via recursion.
 * @param steps - Ordered array of named steps to execute.
 * @param ctx - Initial pipeline context.
 * @returns Procedure with final context on success, or failure with step name.
 */
export default async function execute(
  steps: readonly INamedStep[], ctx: IPipelineContext
): Promise<Procedure<IPipelineContext>> {
  return executeStep(steps, ctx, 0);
}

/**
 * Recursively executes one step at the given index.
 * @param steps - Full step array.
 * @param ctx - Current context from previous step.
 * @param index - Current step index.
 * @returns Procedure with final context or failure.
 */
async function executeStep(
  steps: readonly INamedStep[],
  ctx: IPipelineContext,
  index: number
): Promise<Procedure<IPipelineContext>> {
  if (index >= steps.length) return succeed(ctx, 'pipeline-complete');
  if (ctx.shutdownHandler.isShuttingDown()) {
    return fail('Pipeline aborted: shutdown requested', { status: 'shutdown' });
  }

  const step = steps[index];
  ctx.logger.info(`▶ Step [${step.meta.name}]: ${step.meta.description}`);

  const result = await step.execute(ctx);

  if (isFail(result)) {
    ctx.logger.error(`✖ Step [${step.meta.name}] failed: ${result.message}`);
    return fail(result.message, { status: `step-failed:${step.meta.name}`, error: result.error });
  }

  ctx.logger.info(`✔ Step [${step.meta.name}] complete`);
  return executeStep(steps, result.data, index + 1);
}
