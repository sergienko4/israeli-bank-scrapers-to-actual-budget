/**
 * Scheduler for running imports on a cron schedule
 * Optionally listens for Telegram commands (/scan, /status, /help, /logs)
 */

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { existsSync,readFileSync } from 'node:fs';

import { CronExpressionParser } from 'cron-parser';

import {
decryptConfig, getEncryptionPassword,
  isEncryptedConfig} from './Config/ConfigEncryption.js';
import { ConfigLoader } from './Config/ConfigLoader.js';
import { createLogger, deriveLogFormat,getLogger } from './Logger/Index.js';
import { AuditLogService } from './Services/AuditLogService.js';
import { ImportMediator } from './Services/ImportMediator.js';
import TelegramNotifier from './Services/Notifications/TelegramNotifier.js';
import { TelegramCommandHandler } from './Services/TelegramCommandHandler.js';
import TelegramPoller from './Services/TelegramPoller.js';
import type {
  IImporterConfig, ILogConfig, IProcedureSuccess, ITelegramConfig, Procedure,
} from './Types/Index.js';
import { fail, isFail, succeed } from './Types/Index.js';
import { errorMessage } from './Utils/Index.js';

const DEFAULT_LOG_DIR = './logs';

// Load log config early so all messages use the configured format
const LOG_CONFIG_RESULT = loadLogConfig();
const LOG_CONFIG = LOG_CONFIG_RESULT.success ? LOG_CONFIG_RESULT.data : void 0;
createLogger(LOG_CONFIG);
const LOGGER = getLogger();

LOGGER.info('🚀 Israeli Bank Importer Scheduler Starting...');
LOGGER.info(`📅 Timezone: ${process.env.TZ || 'UTC'}`);

// ─── Config helpers ───

/**
 * Reads a JSON file, decrypting it first if it is an IEncryptedConfig.
 * @param filePath - Absolute path to the JSON file to read.
 * @returns Procedure with parsed object, or failure if file is absent.
 */
export function readJsonOrEncrypted(filePath: string): Procedure<Record<string, string>> {
  if (!existsSync(filePath)) return fail(`File not found: ${filePath}`);
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, string>;
    if (!isEncryptedConfig(parsed)) return succeed(parsed);
    const password = getEncryptionPassword();
    if (!password) return fail('Encryption password required');
    const decryptedJson = decryptConfig(raw, password);
    return succeed(JSON.parse(decryptedJson) as Record<string, string>);
  } catch (error) {
    return fail(`Failed to read ${filePath}: ${errorMessage(error)}`);
  }
}

/**
 * Loads and deep-merges config.json with credentials.json at startup.
 * Delegates to ConfigLoader.loadRaw() which handles proper deep-merge of nested objects.
 * @returns Procedure with the merged IImporterConfig, or failure if absent.
 */
export function loadFullConfig(): Procedure<IImporterConfig> {
  try {
    const loader = new ConfigLoader();
    return loader.loadRaw();
  } catch (error) {
    return fail(`Failed to load config: ${errorMessage(error)}`);
  }
}

/**
 * Derives the ILogConfig from the full config, applying format and logDir defaults.
 * @returns Procedure with ILogConfig, or failure if config cannot be loaded.
 */
export function loadLogConfig(): Procedure<ILogConfig> {
  const configResult = loadFullConfig();
  if (isFail(configResult)) return fail('Cannot derive log config');
  const config = configResult.data;
  const tg = config.notifications?.telegram;
  const hasBot = tg?.listenForCommands === true;
  const format = config.logConfig?.format ?? deriveLogFormat(tg?.messageFormat, hasBot);
  const logDir = config.logConfig?.logDir ?? DEFAULT_LOG_DIR;
  return succeed({ ...config.logConfig, format, maxBufferSize: 0, logDir });
}


// ─── Import execution ───

/**
 * Spawns the import child process and resolves with its exit code.
 * @param extraEnv - Additional environment variables to inject into the child process.
 * @returns Promise resolving to the child process exit code (0 = success).
 */
export function spawnImport(extraEnv: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve) => {
    const startTime = new Date();
    LOGGER.info(`\n⏰ ${startTime.toISOString()}: Starting import...`);
    const env = Object.keys(extraEnv).length > 0 ? { ...process.env, ...extraEnv } : process.env;
    const child: ChildProcess = spawn('node', ['/app/dist/Index.js'], { stdio: 'inherit', env });
    child.on('exit', (exitCode, signal) => {
      const code = exitCode ?? (signal ? 1 : 0);
      if (signal) LOGGER.warn(`Import killed by signal: ${signal}`);
      logImportResult(code, startTime);
      resolve(code);
    });
    child.on('error', (err) => {
      LOGGER.error(`❌ Failed to start import: ${err.message}`);
      resolve(1);
    });
  });
}

/**
 * Logs the result of a completed import child process.
 * @param code - Exit code from the child process (0 if terminated by signal).
 * @param startTime - The Date when the import started, used to compute duration.
 * @returns A successful Procedure indicating the result was logged.
 */
export function logImportResult(
  code: number, startTime: Date
): IProcedureSuccess<{ status: string }> {
  const duration = Math.round((Date.now() - startTime.getTime()) / 1000);
  const time = new Date().toISOString();
  if (code === 0) {
    LOGGER.info(`✅ ${time}: Import completed successfully (took ${String(duration)}s)`);
  } else {
    LOGGER.error(
      `❌ ${time}: Import failed with exit code ${String(code)} (took ${String(duration)}s)`
    );
  }
  return succeed({ status: 'logged' });
}

// ─── Mediator ───

/**
 * Creates an ImportMediator wired to spawnImport and the current config.
 * @param notifierResult - Procedure with TelegramNotifier, or failure for none.
 * @returns A configured ImportMediator instance.
 */
export function createMediator(notifierResult: Procedure<TelegramNotifier>): ImportMediator {
  const notifier = notifierResult.success ? notifierResult.data : void 0;
  return new ImportMediator({
    spawnImport,
    /**
     * Returns all configured bank names from the live config.
     * @returns Array of bank name strings.
     */
    getBankNames: () => {
      const r = loadFullConfig();
      if (!r.success) {
        LOGGER.warn(`getBankNames: config load failed — ${r.message}`);
        return [];
      }
      return Object.keys(r.data.banks);
    },
    notifier: notifier ?? null,
  });
}

// ─── Telegram commands ───

/**
 * Logs how many bot commands will be registered including extra commands.
 * @param extras - Additional commands beyond the built-in set.
 * @returns A successful Procedure indicating the count was logged.
 */
export function logCommandCount(
  extras: { command: string; description: string }[]
): IProcedureSuccess<{ status: string }> {
  const cmdNames = extras.map(c => c.command).join(', /');
  LOGGER.info(
    `📋 Registering ${String(4 + extras.length)} bot commands` +
    (extras.length ? ` (including /${cmdNames})` : '')
  );
  return succeed({ status: 'logged' });
}

/**
 * Lazily imports ConfigLoader and ConfigValidator and runs all validation checks.
 * @returns Formatted validation report string for display in Telegram.
 */
async function runConfigValidation(): Promise<string> {
  // Use ConfigLoader.loadRaw() for correct deep-merge of config.json + credentials.json.
  // loadFullConfig() uses a shallow spread which loses nested fields like actual.init.serverURL.
  const configLoaderModule = await import('./Config/ConfigLoader.js');
  const configValidatorModule = await import('./Config/ConfigValidator.js');
  const loader = new configLoaderModule.ConfigLoader();
  const rawResult = loader.loadRaw();
  if (isFail(rawResult)) {
    return `[FAIL] Cannot load config: ${rawResult.message}`;
  }
  const validator = new configValidatorModule.ConfigValidator();
  const results = await validator.validateAll(rawResult.data);
  return configValidatorModule.ConfigValidator.formatReport(results);
}

/**
 * Constructs a TelegramCommandHandler wired up to all scheduler callbacks.
 * @param notifier - The TelegramNotifier used to send responses.
 * @param mediator - The ImportMediator that handles import requests.
 * @returns A configured TelegramCommandHandler instance.
 */
export function buildCommandHandler(
  notifier: TelegramNotifier,
  mediator: ImportMediator
): TelegramCommandHandler {
  return new TelegramCommandHandler({
    mediator, notifier, auditLog: new AuditLogService(),
    runValidate: runConfigValidation,
    /**
     * Returns all configured bank names from the live config.
     * @returns Array of bank name strings.
     */
    getBankNames: () => {
      const cfg = loadFullConfig();
      if (!cfg.success) {
        LOGGER.warn(`getBankNames: config load failed — ${cfg.message}`);
        return [];
      }
      return Object.keys(cfg.data.banks);
    },
    /**
     * Delegates scan menu display to the notifier.
     * @param banks - Bank names for the inline keyboard.
     * @returns Promise resolving when the menu is sent.
     */
    sendScanMenu: async (banks) => { await notifier.sendScanMenu(banks); return succeed({ status: 'menu-sent' }); },
    logDir: LOG_CONFIG?.logDir,
  });
}

/**
 * Creates the mediator, handler, poller, and wires them together.
 * @param telegram - Telegram bot configuration (token, chatId, etc.).
 * @param config - Full importer config used to detect optional commands (e.g. watch).
 * @returns The configured ImportMediator.
 */
async function createHandlerAndPoller(
  telegram: ITelegramConfig, config: IImporterConfig
): Promise<ImportMediator> {
  const notifier = new TelegramNotifier(telegram);
  const extras = buildExtraCommands(config);
  logCommandCount(extras);
  await notifier.registerCommands(extras);
  const notifierProcedure = succeed(notifier);
  const mediator = createMediator(notifierProcedure);
  const handler = buildCommandHandler(notifier, mediator);
  const poller = new TelegramPoller(
    telegram.botToken, telegram.chatId, (text) => handler.handle(text)
  );
  mediator.setPoller(poller);
  poller.start().catch((err: unknown) => {
    LOGGER.error(`Telegram command listener crashed: ${errorMessage(err)}`);
  });
  return mediator;
}

/**
 * Starts the Telegram command listener when listenForCommands is enabled in config.
 * Errors are caught and logged so the scheduler continues in cron-only mode.
 * @returns Procedure with the ImportMediator, or failure if not enabled.
 */
async function startTelegramCommands(): Promise<Procedure<ImportMediator>> {
  const configResult = loadFullConfig();
  if (isFail(configResult)) return fail('Config not loaded');
  const config = configResult.data;
  const tg = config.notifications?.enabled ? config.notifications.telegram : void 0;
  if (!tg?.listenForCommands) return fail('Telegram commands not enabled');
  try {
    const mediator = await createHandlerAndPoller(tg, config);
    return succeed(mediator);
  } catch (error) {
    LOGGER.error(`⚠️  Failed to start Telegram commands: ${errorMessage(error)}`);
    return fail('Telegram command startup failed', { error: error as Error });
  }
}

/**
 * Builds the list of extra bot commands beyond the built-in set based on config features.
 * @param config - Full importer config used to detect enabled optional features.
 * @returns Array of extra command+description objects to register with Telegram.
 */
export function buildExtraCommands(
  config: IImporterConfig
): { command: string; description: string }[] {
  const extras: { command: string; description: string }[] = [
    { command: 'retry', description: 'Re-import only last failed banks' },
    { command: 'check_config', description: 'Check configuration (offline + online)' },
    { command: 'preview', description: 'Dry run: scrape banks without importing' },
  ];
  const watchLen = config.spendingWatch?.length ?? 0;
  if (watchLen > 0) {
    extras.push({ command: 'watch', description: 'Check spending watch rules' });
  }
  return extras;
}

// ─── Scheduling ───

/**
 * Validates the cron schedule and logs the next scheduled run time.
 * Exits the process with code 1 if the expression is invalid.
 * @param schedule - Cron expression string to validate.
 * @returns A successful Procedure, or exits the process on invalid schedule.
 */
function validateSchedule(schedule: string): IProcedureSuccess<{ status: string }> {
  try {
    const interval = CronExpressionParser.parse(schedule, { tz: process.env.TZ || 'UTC' });
    LOGGER.info(`📅 Next scheduled run: ${interval.next().toString()}`);
    return succeed({ status: 'valid' });
  } catch (err: unknown) {
    LOGGER.error(`❌ Invalid SCHEDULE format: ${errorMessage(err)}`);
    LOGGER.error('   Example: "0 */8 * * *" (every 8 hours)');
    process.exit(1);
  }
}

// Max safe setTimeout value (2^31 - 1 ms ≈ 24.8 days) — prevents overflow to 1ms
const MAX_TIMEOUT_MS = 2147483647;

/**
 * Pauses for the given duration, clamping to the max safe setTimeout value.
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
 * @param schedule - Cron expression defining the import frequency.
 * @param mediator - The ImportMediator used to request imports.
 * @returns 'continue' to re-check, 'imported' when an import was requested.
 */
async function executeScheduleIteration(
  schedule: string, mediator: ImportMediator
): Promise<string> {
  const interval = CronExpressionParser.parse(schedule, { tz: process.env.TZ || 'UTC' });
  const nextRun = interval.next().toDate();
  const msUntilNext = nextRun.getTime() - Date.now();
  const minutesUntil = Math.round(msUntilNext / 1000 / 60);
  LOGGER.info(`⏳ Waiting until ${nextRun.toISOString()} (${String(minutesUntil)} minutes)`);
  await safeSleep(msUntilNext);
  if (Date.now() < nextRun.getTime()) return 'continue';
  mediator.requestImport({ source: 'cron' });
  return 'imported';
}

/**
 * Runs the cron scheduling loop iteratively to avoid unbounded promise chains.
 * @param schedule - Cron expression defining the import frequency.
 * @param mediator - The ImportMediator used to request imports.
 * @returns Promise that never resolves (runs forever until the process exits).
 */
async function scheduleLoop(schedule: string, mediator: ImportMediator): Promise<never> {
  for (;;) {
    try { await executeScheduleIteration(schedule, mediator); }
    catch (err: unknown) {
      LOGGER.error(`❌ Scheduler error: ${errorMessage(err)}`);
      await safeSleep(60000);
    }
  }
}

/**
 * Scheduler entry point: starts Telegram commands and either runs once or enters cron loop.
 * @returns Procedure indicating the scheduler result (never returns in scheduled mode).
 */
async function main(): Promise<Procedure<{ status: string }>> {
  const tgResult = await startTelegramCommands();
  const noTelegramNotifier = fail('telegram not configured');
  const mediator = isFail(tgResult) ? createMediator(noTelegramNotifier) : tgResult.data;
  const schedule = process.env.SCHEDULE;
  if (!schedule) {
    LOGGER.info('📝 Running once (no SCHEDULE set)');
    const batchId = mediator.requestImport({ source: 'cron' });
    if (batchId) {
      const result = await mediator.waitForBatch(batchId);
      process.exit(result.failureCount > 0 ? 1 : 0);
    }
    process.exit(0);
  }
  LOGGER.info(`⏰ Scheduled mode enabled: ${schedule}`);
  LOGGER.info('💡 Import will run according to cron schedule\n');
  validateSchedule(schedule);
  await scheduleLoop(schedule, mediator);
  return succeed({ status: 'completed' });
}

// Run only when executed directly (not when imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main();
  } catch (err: unknown) {
    LOGGER.error(`❌ Fatal error: ${errorMessage(err)}`);
    process.exit(1);
  }
}
