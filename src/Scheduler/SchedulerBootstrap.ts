/**
 * Scheduler entry-point composition.
 *
 * Wires logging, telegram commands, schedule validation, and the cron loop.
 * Every `process.exit(N)` call is delegated to `Process/SchedulerProcessLifecycle.ts`
 * so this module is pure orchestration — tests can verify control flow
 * without spying on the real `process.exit` global.
 */

import { createLogger, getLogger } from '../Logger/Index.js';
import type { ImportMediator } from '../Services/ImportMediator.js';
import type { IProcedureSuccess, Procedure } from '../Types/Index.js';
import { fail, isFail, succeed } from '../Types/Index.js';
import { loadLogConfig } from './ConfigBootstrap.js';
import { scheduleLoop, validateSchedule } from './CronLoop.js';
import {
  buildSchedulerProcessLifecycle,
  type ISchedulerProcessLifecycle,
} from './Process/SchedulerProcessLifecycle.js';
import { createMediator, startTelegramCommands } from './TelegramSchedulerWiring.js';

/**
 * Loads the log config (best-effort), initialises the logger, and prints the banner.
 *
 * @returns Procedure indicating the logger was initialised.
 */
function initLoggingAndBanner(): IProcedureSuccess<{ status: string }> {
  const logConfigResult = loadLogConfig();
  const logConfig = logConfigResult.success ? logConfigResult.data : void 0;
  createLogger(logConfig);
  const logger = getLogger();
  logger.info('🚀 Israeli Bank Importer Scheduler Starting...');
  logger.info(`📅 Timezone: ${process.env.TZ || 'UTC'}`);
  return succeed({ status: 'initialised' });
}

/**
 * Runs a single one-shot import via the mediator and exits via the lifecycle.
 *
 * @param mediator - The ImportMediator used to request the single import.
 * @param lifecycle - Lifecycle handle owning the exit paths.
 * @returns Promise that never returns (lifecycle exits at the end).
 */
async function runOneShotImport(
  mediator: ImportMediator,
  lifecycle: ISchedulerProcessLifecycle,
): Promise<never> {
  getLogger().info('📝 Running once (no SCHEDULE set)');
  const batchId = mediator.requestImport({ source: 'cron' });
  if (batchId) {
    const result = await mediator.waitForBatch(batchId);
    return lifecycle.exitOnImportResult(result);
  }
  return lifecycle.exitClean();
}

/**
 * Validates the schedule, delegating the failure-exit to the lifecycle.
 *
 * @param schedule - Cron expression string to validate.
 * @param lifecycle - Lifecycle handle owning the exit paths.
 * @returns Procedure indicating the schedule is valid (or never returns).
 */
function validateScheduleOrExit(
  schedule: string,
  lifecycle: ISchedulerProcessLifecycle,
): IProcedureSuccess<{ status: string }> {
  const validation = validateSchedule(schedule);
  if (isFail(validation)) lifecycle.exitOnInvalidSchedule(validation.message);
  return succeed({ status: 'valid' });
}

/**
 * Resolves the mediator from a telegram start result, falling back to cron-only mode.
 *
 * @param tgResult - Procedure returned by startTelegramCommands.
 * @returns The active ImportMediator, either from telegram or a cron-only fallback.
 */
function resolveMediator(tgResult: Procedure<ImportMediator>): ImportMediator {
  if (!isFail(tgResult)) return tgResult.data;
  const noTelegramNotifier = fail('telegram not configured');
  return createMediator(noTelegramNotifier);
}

/**
 * Logs the schedule banner, validates the cron, and enters the scheduler loop.
 *
 * @param schedule - Cron expression string from SCHEDULE env var.
 * @param mediator - The ImportMediator used to request imports.
 * @param lifecycle - Lifecycle handle owning the exit paths.
 * @returns Procedure indicating the scheduled session completed.
 */
async function handleScheduledImport(
  schedule: string,
  mediator: ImportMediator,
  lifecycle: ISchedulerProcessLifecycle,
): Promise<Procedure<{ status: string }>> {
  const logger = getLogger();
  logger.info(`⏰ Scheduled mode enabled: ${schedule}`);
  logger.info('💡 Import will run according to cron schedule\n');
  validateScheduleOrExit(schedule, lifecycle);
  await scheduleLoop(schedule, mediator);
  return succeed({ status: 'completed' });
}

/**
 * Scheduler entry point: starts Telegram commands and either runs once or enters cron loop.
 *
 * @param lifecycle - Optional lifecycle override; defaults to live exit/logger.
 * @returns Procedure indicating the scheduler result (never returns in scheduled mode).
 */
export async function runScheduler(
  lifecycle: ISchedulerProcessLifecycle = buildSchedulerProcessLifecycle(),
): Promise<Procedure<{ status: string }>> {
  initLoggingAndBanner();
  const tgResult = await startTelegramCommands();
  const mediator = resolveMediator(tgResult);
  const schedule = process.env.SCHEDULE;
  if (!schedule) return await runOneShotImport(mediator, lifecycle);
  return await handleScheduledImport(schedule, mediator, lifecycle);
}

/**
 * Entry-point wrapper that catches fatal errors and exits via the lifecycle.
 *
 * Called from the Scheduler.ts barrel when the module is executed directly.
 *
 * @param lifecycle - Optional lifecycle override; defaults to live exit/logger.
 * @returns Promise that never resolves (lifecycle exits).
 */
export async function bootScheduler(
  lifecycle: ISchedulerProcessLifecycle = buildSchedulerProcessLifecycle(),
): Promise<never> {
  try {
    await runScheduler(lifecycle);
    return lifecycle.exitClean();
  } catch (err: unknown) {
    return lifecycle.exitOnFatalError(err);
  }
}
