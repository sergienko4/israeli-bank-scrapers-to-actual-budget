/**
 * Cron-driven scheduling loop.
 *
 * Validates the cron expression, computes the next run time, pauses safely
 * (clamping to the setTimeout maximum), and dispatches an import via the
 * ImportMediator. Iterates indefinitely until the process exits.
 */

import { CronExpressionParser } from 'cron-parser';

import { getLogger } from '../Logger/Index.js';
import type { ImportMediator } from '../Services/ImportMediator.js';
import type { IProcedureSuccess, Procedure } from '../Types/Index.js';
import { fail, succeed } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';

const MAX_TIMEOUT_MS = 2147483647;

/**
 * Validates the cron schedule and logs the next scheduled run time.
 *
 * Unlike the previous implementation, this function never terminates the
 * process — the bootstrap caller decides how to react to an invalid cron.
 *
 * @param schedule - Cron expression string to validate.
 * @returns Procedure with the parsed next-run timestamp, or failure.
 */
export function validateSchedule(schedule: string): Procedure<{ nextRunIso: string }> {
  try {
    const interval = CronExpressionParser.parse(schedule, { tz: process.env.TZ || 'UTC' });
    const nextRunIso = interval.next().toString();
    getLogger().info(`📅 Next scheduled run: ${nextRunIso}`);
    return succeed({ nextRunIso });
  } catch (err: unknown) {
    return fail(`Invalid SCHEDULE format: ${errorMessage(err)}`);
  }
}

/**
 * Pauses for the given duration, clamping to the max safe setTimeout value.
 *
 * @param ms - Desired sleep duration in milliseconds.
 * @returns Procedure indicating the wait completed.
 */
export async function safeSleep(ms: number): Promise<IProcedureSuccess<{ status: string }>> {
  const clampedMs = Math.min(ms, MAX_TIMEOUT_MS);
  const { setTimeout: waitMs } = await import('node:timers/promises');
  await waitMs(clampedMs);
  return succeed({ status: 'waited' });
}

/**
 * Executes one iteration of the cron loop: wait, then request an import.
 *
 * @param schedule - Cron expression defining the import frequency.
 * @param mediator - The ImportMediator used to request imports.
 * @returns 'continue' to re-check, 'imported' when an import was requested.
 */
export async function executeScheduleIteration(
  schedule: string, mediator: ImportMediator
): Promise<string> {
  const interval = CronExpressionParser.parse(schedule, { tz: process.env.TZ || 'UTC' });
  const nextRun = interval.next().toDate();
  const msUntilNext = nextRun.getTime() - Date.now();
  const minutesUntil = Math.round(msUntilNext / 1000 / 60);
  getLogger().info(`⏳ Waiting until ${nextRun.toISOString()} (${String(minutesUntil)} minutes)`);
  await safeSleep(msUntilNext);
  if (Date.now() < nextRun.getTime()) return 'continue';
  mediator.requestImport({ source: 'cron' });
  return 'imported';
}

/**
 * Runs one iteration and schedules the next via setImmediate.
 *
 * Recursive scheduling via setImmediate breaks the promise chain between
 * iterations so the chain does not grow unbounded, and avoids `await` inside
 * a loop construct.
 *
 * @param schedule - Cron expression defining the import frequency.
 * @param mediator - The ImportMediator used to request imports.
 * @returns Procedure indicating the next iteration was scheduled.
 */
function scheduleNextIteration(
  schedule: string, mediator: ImportMediator
): IProcedureSuccess<{ status: string }> {
  executeScheduleIteration(schedule, mediator)
    .catch(async (err: unknown) => {
      getLogger().error(`❌ Scheduler error: ${errorMessage(err)}`);
      await safeSleep(60000);
    })
    .finally(() => {
      setImmediate(() => {
        scheduleNextIteration(schedule, mediator);
      });
    });
  return succeed({ status: 'scheduled' });
}

/**
 * Runs the cron scheduling loop iteratively to avoid unbounded promise chains.
 *
 * @param schedule - Cron expression defining the import frequency.
 * @param mediator - The ImportMediator used to request imports.
 * @returns Promise that never resolves (runs forever until the process exits).
 */
export function scheduleLoop(
  schedule: string, mediator: ImportMediator
): Promise<never> {
  return new Promise<never>(() => {
    scheduleNextIteration(schedule, mediator);
  });
}
