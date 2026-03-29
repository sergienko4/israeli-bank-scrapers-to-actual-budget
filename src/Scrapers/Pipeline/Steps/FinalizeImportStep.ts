/**
 * Pipeline step: Finalize the import — print summary, send notifications, shutdown API.
 */

import type { IPipelineContext, PipelineStep, Procedure } from '../Index.js';
import { isFail, succeed } from '../Index.js';

/** The summary data type returned by metricsService.getSummary(). */
type SummaryData = Extract<
  ReturnType<IPipelineContext['services']['metricsService']['getSummary']>,
  { success: true }
>['data'];

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
  return buildInnerStep(actualApi);
}

/**
 * Builds the inner step closure that finalizes the import.
 * @param actualApi - The actual-app/api module for shutdown.
 * @param actualApi.shutdown - Shuts down the API connection.
 * @returns PipelineStep that prints summary, notifies, and shuts down.
 */
function buildInnerStep(
  actualApi: IActualApiShutdown
): PipelineStep {
  /**
   * Inner step that finalizes the import.
   * @param ctx - Pipeline context for this step.
   * @returns Procedure with exit code in state.
   */
  return async (ctx: IPipelineContext): ReturnType<PipelineStep> => {
    logPrintSummary(ctx);
    return await runFinalizeWithShutdown(ctx, actualApi);
  };
}

/**
 * Logs a warning if printSummary fails.
 * @param ctx - Pipeline context.
 * @returns Procedure indicating whether printSummary succeeded.
 */
function logPrintSummary(
  ctx: IPipelineContext
): Procedure<boolean> {
  const printResult = ctx.services.metricsService.printSummary();
  if (isFail(printResult)) {
    ctx.logger.warn(`printSummary failed: ${printResult.message}`);
    return succeed(false, 'print-summary-failed');
  }
  return succeed(true, 'print-summary-ok');
}

/**
 * Runs finalize logic and ensures shutdown on completion.
 * @param ctx - Pipeline context.
 * @param actualApi - Actual API for shutdown.
 * @param actualApi.shutdown - Shuts down the API connection.
 * @returns Procedure with exit code in state.
 */
async function runFinalizeWithShutdown(
  ctx: IPipelineContext,
  actualApi: IActualApiShutdown
): ReturnType<PipelineStep> {
  try {
    return await dispatchFinalize(ctx, actualApi);
  } finally {
    await safeShutdown(actualApi);
  }
}

/**
 * Best-effort shutdown of the Actual API.
 * @param actualApi - Actual API for shutdown.
 * @param actualApi.shutdown - Shuts down the API connection.
 * @returns Procedure indicating whether shutdown succeeded.
 */
async function safeShutdown(
  actualApi: IActualApiShutdown
): Promise<Procedure<boolean>> {
  try { await actualApi.shutdown(); } catch { return succeed(false, 'shutdown-error'); }
  return succeed(true, 'shutdown-ok');
}

/**
 * Dispatches to dry-run or normal finalize based on context.
 * @param ctx - Pipeline context.
 * @param _api - Actual API (unused in dispatch).
 * @returns Procedure with exit code in state.
 */
async function dispatchFinalize(
  ctx: IPipelineContext,
  _api: IActualApiShutdown
): ReturnType<PipelineStep> {
  if (ctx.state.isDryRun) {
    return await finalizeDryRun(ctx, _api);
  }
  return await finalizeNormalImport(ctx);
}

/**
 * Finalizes a dry-run: logs preview and sends notification.
 * @param ctx - Pipeline context.
 * @param _api - Actual API for shutdown.
 * @param _api.shutdown - Shuts down the API connection.
 * @returns Updated context with exit code.
 */
async function finalizeDryRun(
  ctx: Parameters<PipelineStep>[0],
  _api: IActualApiShutdown
): ReturnType<PipelineStep> {
  const preview = ctx.services.dryRunCollector.formatText();
  ctx.logger.info(preview);
  const telegramPreview =
    ctx.services.dryRunCollector.formatTelegram();
  const msgResult = await ctx.services.notificationService.sendMessage(
    telegramPreview
  );
  if (isFail(msgResult)) {
    ctx.logger.warn(`sendMessage failed: ${msgResult.message}`);
  }
  return succeed({
    ...ctx,
    state: { ...ctx.state, exitCode: 0 },
  });
}

/**
 * Finalizes a normal import: records audit, sends summary.
 * @param ctx - Pipeline context.
 * @returns Updated context with exit code.
 */
async function finalizeNormalImport(
  ctx: Parameters<PipelineStep>[0]
): ReturnType<PipelineStep> {
  const summaryResult = ctx.services.metricsService.getSummary();
  if (!summaryResult.success) {
    ctx.logger.warn(`getSummary failed: ${summaryResult.message}`);
    return completeImport(ctx);
  }
  await recordAndNotify(ctx, summaryResult.data);
  return completeImport(ctx);
}

/**
 * Records audit log and sends notification for summary data.
 * @param ctx - Pipeline context.
 * @param data - Summary data to record and send.
 * @returns Procedure indicating notification status.
 */
async function recordAndNotify(
  ctx: Parameters<PipelineStep>[0],
  data: SummaryData
): Promise<Procedure<boolean>> {
  const recordResult = ctx.services.auditLogService.record(data);
  if (isFail(recordResult)) {
    ctx.logger.warn(`audit record failed: ${recordResult.message}`);
  }
  const sendResult =
    await ctx.services.notificationService.sendSummary(data);
  if (isFail(sendResult)) {
    ctx.logger.warn(`sendSummary failed: ${sendResult.message}`);
    return succeed(false, 'send-summary-failed');
  }
  return succeed(true, 'record-and-notify-ok');
}

/**
 * Logs completion and builds the exit result.
 * @param ctx - Pipeline context.
 * @returns Procedure with exit code reflecting success or failure.
 */
function completeImport(
  ctx: Parameters<PipelineStep>[0]
): Procedure<IPipelineContext> {
  ctx.logger.info('\nImport process completed!');
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
  const exitCode = resolveExitCode(ctx);
  return succeed({
    ...ctx,
    state: { ...ctx.state, exitCode },
  });
}

/** Map from failure status to exit code. */
const EXIT_CODE: Record<string, number> = {
  true: 1,
  false: 0,
};

/**
 * Resolves the exit code from the metrics service failure status.
 * @param ctx - Pipeline context with metrics service.
 * @returns 1 for failures, 0 for success.
 */
function resolveExitCode(
  ctx: Parameters<PipelineStep>[0]
): number {
  const failureResult = ctx.services.metricsService.hasFailures();
  if (!failureResult.success) {
    return 1;
  }
  return EXIT_CODE[String(failureResult.data)] ?? 1;
}
