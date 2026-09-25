/**
 * PipelineRunner — executes a sequence of named steps, threading immutable context.
 * Short-circuits on failure. Checks shutdown between steps.
 */

import redactSecrets from '../../../Logger/SecretRedaction.js';
import type { IProcedureFailure, Procedure } from '../../../Types/Index.js';
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
 *
 * <p>The cause is masked on its own: an error can quote a server reply that
 * holds a token, and the line must be safe whichever logger receives it.
 * @param error - Optional original error carried by the failure.
 * @returns A masked ' | cause: <stack>' suffix, or '' when no error is present.
 */
function formatCause(error?: Error): string {
  if (!error) return '';
  const cause = redactSecrets(error.stack ?? error.message);
  return ` | cause: ${cause}`;
}

/**
 * Builds the log line for a failed step.
 *
 * <p>The step's message and its cause are masked apart: a secret a bank's
 * snippet cut off hides the rest of the text it is masked in, so masking the
 * whole line at once would hide the cause too.
 * @param name - The failed step's name.
 * @param failure - The step's failure.
 * @returns The line to log.
 */
function failureLine(name: string, failure: IProcedureFailure): string {
  const detail = redactSecrets(failure.message);
  const cause = formatCause(failure.error);
  return `✖ Step [${name}] failed: ${detail}${cause}`;
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
    const line = failureLine(step.meta.name, result);
    ctx.logger.error(line);
    return fail(result.message, { status: `step-failed:${step.meta.name}`, error: result.error });
  }

  ctx.logger.info(`✔ Step [${step.meta.name}] complete`);
  return await executeStep(steps, result.data, index + 1);
}
