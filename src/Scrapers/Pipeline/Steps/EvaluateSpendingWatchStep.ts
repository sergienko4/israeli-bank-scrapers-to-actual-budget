/**
 * Pipeline step: Evaluate spending watch rules and send alerts if triggered.
 * Skips when in dry-run mode or when no rules are configured.
 */

import type { IPipelineContext, PipelineStep, Procedure } from '../Index.js';
import { isFail, succeed } from '../Index.js';

/** Shape of the spending watch service dependency. */
export interface IWatchService {
  readonly evaluate: () => Promise<Procedure<IWatchResultData | { noAlerts: true }>>;
}

/** Shape of evaluation result data that may contain an alert message. */
export interface IWatchResultData {
  readonly message?: string;
}

/**
 * Creates a step that evaluates spending watch rules.
 * @param watchService - Service with an evaluate method.
 * @param watchService.evaluate - Evaluates spending rules.
 * @returns PipelineStep that checks spending and sends alerts.
 */
export default function createEvaluateSpendingWatchStep(
  watchService: IWatchService
): PipelineStep {
  /**
   * Inner step that evaluates watch rules.
   * @param ctx - Pipeline context for this step.
   * @returns Procedure with updated context.
   */
  return async (ctx: IPipelineContext): ReturnType<PipelineStep> => {
    if (ctx.state.isDryRun) {
      return skipWatch(ctx);
    }
    if (!ctx.config.spendingWatch?.length) {
      return skipWatch(ctx);
    }

    return evaluateRules(ctx, watchService);
  };
}

/**
 * Returns a skipped-watch result with alertSent = false.
 * @param ctx - Pipeline context.
 * @returns Successful Procedure with alertSent false.
 */
function skipWatch(
  ctx: IPipelineContext
): Procedure<IPipelineContext> {
  return succeed({
    ...ctx,
    state: { ...ctx.state, alertSent: false },
  });
}

/**
 * Evaluates spending watch rules and sends alerts if triggered.
 * @param ctx - Pipeline context.
 * @param watchService - Service with an evaluate method.
 * @returns Procedure with updated context.
 */
async function evaluateRules(
  ctx: IPipelineContext,
  watchService: IWatchService
): ReturnType<PipelineStep> {
  ctx.logger.info('\nEvaluating spending watch rules...');
  const result = await watchService.evaluate();
  if (isFail(result)) {
    ctx.logger.warn(`Spending watch error: ${result.message}`);
    return skipWatch(ctx);
  }

  const hasAlert = await sendAlertIfPresent(ctx, result.data);
  return succeed({
    ...ctx,
    state: { ...ctx.state, alertSent: hasAlert },
  });
}

/**
 * Sends an alert notification if the watch result contains a message.
 * @param ctx - Pipeline context with notification service.
 * @param data - The watch evaluation result data.
 * @returns True if an alert was sent.
 */
async function sendAlertIfPresent(
  ctx: IPipelineContext,
  data: IWatchResultData | { noAlerts: true }
): Promise<boolean> {
  if (!('message' in data) || typeof data.message !== 'string' || data.message.length === 0) {
    return false;
  }
  const sendResult = await ctx.services.notificationService.sendMessage(
    data.message
  );
  if (isFail(sendResult)) {
    ctx.logger.warn(`Spending watch alert failed to send: ${sendResult.message}`);
    return false;
  }
  return true;
}
