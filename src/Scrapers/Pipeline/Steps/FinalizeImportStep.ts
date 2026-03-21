/**
 * Pipeline step: Finalize the import — print summary, send notifications, shutdown API.
 */

import type { IPipelineContext, PipelineStep, Procedure } from '../Index.js';
import { succeed } from '../Index.js';

/**
 * Opaque result type for Actual API calls whose return value is discarded.
 * The type alias hides `void` from ESLint function-type selectors.
 */
export type ApiSideEffect = Promise<void>;

/** Shape of the Actual API shutdown dependency. */
export interface IActualApiShutdown {
  readonly shutdown: () => ApiSideEffect;
}

/**
 * Creates a step that finalizes the import process.
 * @param actualApi - The actual-app/api module for shutdown.
 * @param actualApi.shutdown - Shuts down the API connection.
 * @returns PipelineStep that prints summary, notifies, and shuts down.
 */
export default function createFinalizeImportStep(
  actualApi: IActualApiShutdown
): PipelineStep {
  /**
   * Inner step that finalizes the import.
   * @param ctx - Pipeline context for this step.
   * @returns Procedure with exit code in state.
   */
  return async (ctx: IPipelineContext): ReturnType<PipelineStep> => {
    ctx.services.metricsService.printSummary();

    if (ctx.state.isDryRun) {
      return finalizeDryRun(ctx, actualApi);
    }

    return finalizeNormalImport(ctx, actualApi);
  };
}

/**
 * Finalizes a dry-run: logs preview and sends notification.
 * @param ctx - Pipeline context.
 * @param api - Actual API for shutdown.
 * @param api.shutdown - Shuts down the API connection.
 * @returns Updated context with exit code.
 */
async function finalizeDryRun(
  ctx: Parameters<PipelineStep>[0],
  api: IActualApiShutdown
): ReturnType<PipelineStep> {
  const preview = ctx.services.dryRunCollector.formatText();
  ctx.logger.info(preview);
  const telegramPreview =
    ctx.services.dryRunCollector.formatTelegram();
  await ctx.services.notificationService.sendMessage(
    telegramPreview
  );
  await api.shutdown();
  return succeed({
    ...ctx,
    state: { ...ctx.state, exitCode: 0 },
  });
}

/**
 * Finalizes a normal import: records audit, sends summary.
 * @param ctx - Pipeline context.
 * @param api - Actual API for shutdown.
 * @param api.shutdown - Shuts down the API connection.
 * @returns Updated context with exit code.
 */
async function finalizeNormalImport(
  ctx: Parameters<PipelineStep>[0],
  api: IActualApiShutdown
): ReturnType<PipelineStep> {
  const summaryResult = ctx.services.metricsService.getSummary();
  if (summaryResult.success) {
    ctx.services.auditLogService.record(summaryResult.data);
    await ctx.services.notificationService.sendSummary(
      summaryResult.data
    );
  }
  ctx.logger.info('\nImport process completed!');
  await api.shutdown();
  return buildExitResult(ctx);
}

/**
 * Builds the final exit code result based on failure status.
 * @param ctx - Pipeline context with metrics service.
 * @returns Procedure with exit code reflecting success or failure.
 */
function buildExitResult(
  ctx: Parameters<PipelineStep>[0]
): Procedure<IPipelineContext> {
  const failureResult = ctx.services.metricsService.hasFailures();
  const hasFailures = failureResult.success && failureResult.data;
  const exitCodeLookup: Record<string, number> = {
    'true': 1,
    'false': 0,
  };
  const exitCode = exitCodeLookup[String(hasFailures)] ?? 0;
  return succeed({
    ...ctx,
    state: { ...ctx.state, exitCode },
  });
}
