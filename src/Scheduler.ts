/**
 * Scheduler barrel and entry point.
 *
 * Re-exports the public surface used by tests, then optionally boots the
 * scheduler when the file is executed directly as a Node entry point.
 *
 * The actual implementation lives in src/Scheduler/*.ts:
 *   - ConfigBootstrap.ts          — load and decrypt config, derive log config
 *   - ImportProcessRunner.ts      — spawn the import child process
 *   - TelegramSchedulerWiring.ts  — mediator + command handler + poller wiring
 *   - CronLoop.ts                 — cron validation, safe sleep, schedule loop
 *   - SchedulerBootstrap.ts       — composition + single process.exit site
 */

import { bootScheduler } from './Scheduler/SchedulerBootstrap.js';

export {
  loadFullConfig,
  loadLogConfig,
  readJsonOrEncrypted,
} from './Scheduler/ConfigBootstrap.js';
export { safeSleep } from './Scheduler/CronLoop.js';
export { logImportResult, spawnImport } from './Scheduler/ImportProcessRunner.js';
export {
  buildCommandHandler,
  buildExtraCommands,
  createMediator,
  logCommandCount,
} from './Scheduler/TelegramSchedulerWiring.js';

if (import.meta.url === `file://${process.argv[1]}`) {
  await bootScheduler();
}
