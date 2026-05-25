/**
 * Scheduler entry-point composition.
 *
 * Wires logging, telegram commands, schedule validation, and the cron loop.
 * This is the only module that calls process.exit and the only module that
 * runs LOGGER.info startup banners.
 */

import { createLogger, getLogger } from '../Logger/Index.js';
import type { ImportMediator } from '../Services/ImportMediator.js';
import type { IProcedureSuccess, Procedure } from '../Types/Index.js';
import { fail, isFail, succeed } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';
import { loadLogConfig } from './ConfigBootstrap.js';
import { scheduleLoop, validateSchedule } from './CronLoop.js';
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
 * Runs a single one-shot import via the mediator and exits with the appropriate code.
 *
 * @param mediator - The ImportMediator used to request the single import.
 * @returns Promise that never returns (process exits at the end).
 */
async function runOneShotImport(mediator: ImportMediator): Promise<never> {
  getLogger().info('📝 Running once (no SCHEDULE set)');
  const batchId = mediator.requestImport({ source: 'cron' });
  if (batchId) {
    const result = await mediator.waitForBatch(batchId);
    process.exit(result.failureCount > 0 ? 1 : 0);
  }
  process.exit(0);
}

/**
 * Validates the schedule and exits with code 1 if it is invalid.
 *
 * @param schedule - Cron expression string to validate.
 * @returns Procedure indicating the schedule is valid (or never returns).
 */
function validateScheduleOrExit(schedule: string): IProcedureSuccess<{ status: string }> {
  const validation = validateSchedule(schedule);
  if (isFail(validation)) {
    const logger = getLogger();
    logger.error(`❌ ${validation.message}`);
    logger.error('   Example: "0 */8 * * *" (every 8 hours)');
    process.exit(1);
  }
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
 * @returns Procedure indicating the scheduled session completed.
 */
async function handleScheduledImport(
  schedule: string, mediator: ImportMediator
): Promise<Procedure<{ status: string }>> {
  const logger = getLogger();
  logger.info(`⏰ Scheduled mode enabled: ${schedule}`);
  logger.info('💡 Import will run according to cron schedule\n');
  validateScheduleOrExit(schedule);
  await scheduleLoop(schedule, mediator);
  return succeed({ status: 'completed' });
}

/**
 * Scheduler entry point: starts Telegram commands and either runs once or enters cron loop.
 *
 * @returns Procedure indicating the scheduler result (never returns in scheduled mode).
 */
export async function runScheduler(): Promise<Procedure<{ status: string }>> {
  initLoggingAndBanner();
  const tgResult = await startTelegramCommands();
  const mediator = resolveMediator(tgResult);
  const schedule = process.env.SCHEDULE;
  if (!schedule) return await runOneShotImport(mediator);
  return await handleScheduledImport(schedule, mediator);
}

/**
 * Entry-point wrapper that catches fatal errors and exits with code 1.
 *
 * Called from the Scheduler.ts barrel when the module is executed directly.
 *
 * @returns Promise that never resolves (process exits).
 */
export async function bootScheduler(): Promise<never> {
  try {
    await runScheduler();
    process.exit(0);
  } catch (err: unknown) {
    getLogger().error(`❌ Fatal error: ${errorMessage(err)}`);
    process.exit(1);
  }
}
