/**
 * Scheduler for running imports on a cron schedule
 * Optionally listens for Telegram commands (/scan, /status, /help, /logs)
 */

import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { CronExpressionParser } from 'cron-parser';
import { TelegramPoller } from './Services/TelegramPoller.js';
import { TelegramCommandHandler } from './Services/TelegramCommandHandler.js';
import { TelegramNotifier } from './Services/Notifications/TelegramNotifier.js';
import { ImportMediator } from './Services/ImportMediator.js';
import type { ImporterConfig, LogConfig, TelegramConfig } from './Types/Index.js';
import { AuditLogService } from './Services/AuditLogService.js';
import { errorMessage } from './Utils/Index.js';
import { createLogger, getLogger, deriveLogFormat } from './Logger/Index.js';
import {
  isEncryptedConfig, decryptConfig, getEncryptionPassword
} from './Config/ConfigEncryption.js';

const DEFAULT_LOG_DIR = './logs';

// Load log config early so all messages use the configured format
const logConfig = loadLogConfig();
createLogger(logConfig);
const logger = getLogger();

logger.info('🚀 Israeli Bank Importer Scheduler Starting...');
logger.info(`📅 Timezone: ${process.env.TZ || 'UTC'}`);

// ─── Config helpers ───

/**
 * Reads a JSON file, decrypting it first if it is an EncryptedConfig.
 * @param filePath - Absolute path to the JSON file to read.
 * @returns Parsed object, or null if the file is absent or cannot be decrypted.
 */
export function readJsonOrEncrypted(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!isEncryptedConfig(parsed)) return parsed as Record<string, unknown>;
  const password = getEncryptionPassword();
  return password
    ? JSON.parse(decryptConfig(raw, password)) as Record<string, unknown>
    : null;
}

/**
 * Loads and shallow-merges config.json with credentials.json at startup.
 * @returns The merged ImporterConfig, or null if config.json is absent.
 */
export function loadFullConfig(): ImporterConfig | null {
  try {
    const config = readJsonOrEncrypted('/app/config.json');
    if (!config) return null;
    const creds = readJsonOrEncrypted('/app/credentials.json');
    return (creds ? { ...config, ...creds } : config) as unknown as ImporterConfig;
  } catch { return null; }
}

/**
 * Derives the LogConfig from the full config, applying format and logDir defaults.
 * @returns LogConfig to pass to createLogger, or undefined if config cannot be loaded.
 */
export function loadLogConfig(): LogConfig | undefined {
  const config = loadFullConfig();
  if (!config) return undefined;
  const tg = config.notifications?.telegram;
  const hasBot = tg?.listenForCommands === true;
  const format = config.logConfig?.format ?? deriveLogFormat(tg?.messageFormat, hasBot);
  const logDir = config.logConfig?.logDir ?? DEFAULT_LOG_DIR;
  return { ...config.logConfig, format, maxBufferSize: 0, logDir };
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
    logger.info(`\n⏰ ${startTime.toISOString()}: Starting import...`);
    const env = Object.keys(extraEnv).length > 0 ? { ...process.env, ...extraEnv } : process.env;
    const child: ChildProcess = spawn('node', ['/app/dist/Index.js'], { stdio: 'inherit', env });
    child.on('exit', (code) => { logImportResult(code, startTime); resolve(code ?? 0); });
    child.on('error', (err) => {
      logger.error(`❌ Failed to start import: ${err.message}`);
      resolve(1);
    });
  });
}

/**
 * Logs the result of a completed import child process.
 * @param code - Exit code from the child process (null if terminated by signal).
 * @param startTime - The Date when the import started, used to compute duration.
 */
export function logImportResult(code: number | null, startTime: Date): void {
  const duration = Math.round((Date.now() - startTime.getTime()) / 1000);
  const time = new Date().toISOString();
  if (code === 0) {
    logger.info(`✅ ${time}: Import completed successfully (took ${duration}s)`);
  } else {
    logger.error(`❌ ${time}: Import failed with exit code ${code} (took ${duration}s)`);
  }
}

// ─── Mediator ───

/**
 * Creates an ImportMediator wired to spawnImport and the current config.
 * @param notifier - Optional TelegramNotifier for batch summaries.
 * @returns A configured ImportMediator instance.
 */
export function createMediator(notifier: TelegramNotifier | null): ImportMediator {
  return new ImportMediator({
    spawnImport,
    /**
     * Returns all configured bank names from the live config.
     * @returns Array of bank name strings.
     */
    getBankNames: () => Object.keys(loadFullConfig()?.banks ?? {}),
    notifier,
  });
}

// ─── Telegram commands ───

/**
 * Logs how many bot commands will be registered including extra commands.
 * @param extras - Additional commands beyond the built-in set.
 */
export function logCommandCount(extras: Array<{ command: string; description: string }>): void {
  const cmdNames = extras.map(c => c.command).join(', /');
  logger.info(
    `📋 Registering ${4 + extras.length} bot commands` +
    (extras.length ? ` (including /${cmdNames})` : '')
  );
}

/**
 * Lazily imports ConfigLoader and ConfigValidator and runs all validation checks.
 * @returns Formatted validation report string for display in Telegram.
 */
async function runConfigValidation(): Promise<string> {
  // Use ConfigLoader.loadRaw() for correct deep-merge of config.json + credentials.json.
  // loadFullConfig() uses a shallow spread which loses nested fields like actual.init.serverURL.
  const { ConfigLoader } = await import('./Config/ConfigLoader.js');
  const { ConfigValidator } = await import('./Config/ConfigValidator.js');
  const loader = new ConfigLoader();
  let config;
  try {
    config = loader.loadRaw();
  } catch (e) {
    return `[FAIL] Cannot load config: ${errorMessage(e)}`;
  }
  const validator = new ConfigValidator();
  const results = await validator.validateAll(config);
  return validator.formatReport(results);
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
    getBankNames: () => Object.keys(loadFullConfig()?.banks ?? {}),
    /**
     * Delegates scan menu display to the notifier.
     * @param banks - Bank names for the inline keyboard.
     * @returns Promise resolving when the menu is sent.
     */
    sendScanMenu: (banks) => notifier.sendScanMenu(banks),
    logDir: logConfig?.logDir,
  });
}

/**
 * Creates the mediator, handler, poller, and wires them together.
 * @param telegram - Telegram bot configuration (token, chatId, etc.).
 * @param config - Full importer config used to detect optional commands (e.g. watch).
 * @returns The configured ImportMediator.
 */
async function createHandlerAndPoller(
  telegram: TelegramConfig, config: ImporterConfig | null
): Promise<ImportMediator> {
  const notifier = new TelegramNotifier(telegram);
  const extras = buildExtraCommands(config);
  logCommandCount(extras);
  await notifier.registerCommands(extras);
  const mediator = createMediator(notifier);
  const handler = buildCommandHandler(notifier, mediator);
  const poller = new TelegramPoller(
    telegram.botToken, telegram.chatId, (text) => handler.handle(text)
  );
  mediator.setPoller(poller);
  poller.start().catch((err: unknown) => {
    logger.error(`Telegram command listener crashed: ${errorMessage(err)}`);
  });
  return mediator;
}

/**
 * Starts the Telegram command listener when listenForCommands is enabled in config.
 * Errors are caught and logged so the scheduler continues in cron-only mode.
 * @returns The ImportMediator if Telegram commands are enabled, or null otherwise.
 */
async function startTelegramCommands(): Promise<ImportMediator | null> {
  const config = loadFullConfig();
  const telegram = config?.notifications?.enabled ? config.notifications.telegram : null;
  if (!telegram?.listenForCommands) return null;
  try {
    return await createHandlerAndPoller(telegram, config);
  } catch (error: unknown) {
    logger.error(`⚠️  Failed to start Telegram commands: ${errorMessage(error)}`);
    return null;
  }
}

/**
 * Builds the list of extra bot commands beyond the built-in set based on config features.
 * @param config - Full importer config used to detect enabled optional features.
 * @returns Array of extra command+description objects to register with Telegram.
 */
export function buildExtraCommands(
  config: ImporterConfig | null
): Array<{ command: string; description: string }> {
  const extras: Array<{ command: string; description: string }> = [
    { command: 'check_config', description: 'Check configuration (offline + online)' },
    { command: 'preview', description: 'Dry run: scrape banks without importing' },
  ];
  if ((config?.spendingWatch?.length ?? 0) > 0) {
    extras.push({ command: 'watch', description: 'Check spending watch rules' });
  }
  return extras;
}

// ─── Scheduling ───

/**
 * Validates the cron schedule and logs the next scheduled run time.
 * Exits the process with code 1 if the expression is invalid.
 * @param schedule - Cron expression string to validate.
 */
function validateSchedule(schedule: string): void {
  try {
    const interval = CronExpressionParser.parse(schedule, { tz: process.env.TZ || 'UTC' });
    logger.info(`📅 Next scheduled run: ${interval.next().toString()}`);
  } catch (err: unknown) {
    logger.error(`❌ Invalid SCHEDULE format: ${errorMessage(err)}`);
    logger.error('   Example: "0 */8 * * *" (every 8 hours)');
    process.exit(1);
  }
}

// Max safe setTimeout value (2^31 - 1 ms ≈ 24.8 days) — prevents overflow to 1ms
const MAX_TIMEOUT_MS = 2147483647;

/**
 * Pauses for the given duration, clamping to the max safe setTimeout value.
 * @param ms - Desired sleep duration in milliseconds.
 * @returns Promise that resolves after the (clamped) delay.
 */
export function safeSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.min(ms, MAX_TIMEOUT_MS)));
}

/**
 * Runs the cron scheduling loop, sleeping until the next scheduled time.
 * @param schedule - Cron expression defining the import frequency.
 * @param mediator - The ImportMediator used to request imports.
 * @returns Promise that never resolves (runs forever until the process exits).
 */
async function scheduleLoop(schedule: string, mediator: ImportMediator): Promise<never> {
  while (true) {
    try {
      const interval = CronExpressionParser.parse(schedule, { tz: process.env.TZ || 'UTC' });
      const nextRun = interval.next().toDate();
      const msUntilNext = nextRun.getTime() - Date.now();
      const minutesUntil = Math.round(msUntilNext / 1000 / 60);
      logger.info(`⏳ Waiting until ${nextRun.toISOString()} (${minutesUntil} minutes)`);
      await safeSleep(msUntilNext);
      if (Date.now() < nextRun.getTime()) continue; // Woke early, re-check
      mediator.requestImport({ source: 'cron' });
    } catch (err: unknown) {
      logger.error(`❌ Scheduler error: ${errorMessage(err)}`);
      await safeSleep(60000);
    }
  }
}

/**
 * Scheduler entry point: starts Telegram commands and either runs once or enters cron loop.
 */
async function main(): Promise<void> {
  const mediator = await startTelegramCommands() ?? createMediator(null);
  const schedule = process.env.SCHEDULE;
  if (!schedule) {
    logger.info('📝 Running once (no SCHEDULE set)');
    const batchId = mediator.requestImport({ source: 'cron' });
    if (batchId) {
      const result = await mediator.waitForBatch(batchId);
      process.exit(result.failureCount > 0 ? 1 : 0);
    }
    process.exit(0);
  }
  logger.info(`⏰ Scheduled mode enabled: ${schedule}`);
  logger.info('💡 Import will run according to cron schedule\n');
  validateSchedule(schedule);
  await scheduleLoop(schedule, mediator);
}

// Run only when executed directly (not when imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    logger.error(`❌ Fatal error: ${errorMessage(err)}`);
    process.exit(1);
  });
}
