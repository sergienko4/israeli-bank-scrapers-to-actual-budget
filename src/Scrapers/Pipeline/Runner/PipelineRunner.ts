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
  return await executeStep(steps, ctx, 0);
}

/**
 * Builds a cause suffix from a failed step's underlying error so the real
 * error surfaces in logs instead of being hidden behind the step message.
 * @param error - Optional original error carried by the failure.
 * @returns A ' | cause: <stack>' suffix, or '' when no error is present.
 */
function formatCause(error?: Error): string {
  if (!error) return '';
  return ` | cause: ${error.stack ?? error.message}`;
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
    const cause = formatCause(result.error);
    ctx.logger.error(`✖ Step [${step.meta.name}] failed: ${result.message}${cause}`);
    return fail(result.message, { status: `step-failed:${step.meta.name}`, error: result.error });
  }

  ctx.logger.info(`✔ Step [${step.meta.name}] complete`);
  return await executeStep(steps, result.data, index + 1);
}
