/**
 * Scheduler for running imports on a cron schedule
 * Optionally listens for Telegram commands (/scan, /status, /help, /logs)
 */

import { spawn, ChildProcess } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { CronExpressionParser } from 'cron-parser';
import { TelegramPoller } from './Services/TelegramPoller.js';
import { TelegramCommandHandler } from './Services/TelegramCommandHandler.js';
import { TelegramNotifier } from './Services/Notifications/TelegramNotifier.js';
import { ImporterConfig, LogConfig, TelegramConfig } from './Types/index.js';
import { AuditLogService } from './Services/AuditLogService.js';
import { errorMessage } from './Utils/index.js';
import { createLogger, getLogger, deriveLogFormat } from './Logger/index.js';
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

let activeImport: Promise<number> | null = null;
let activePoller: TelegramPoller | null = null;

// ─── Config helpers ───

function readJsonOrEncrypted(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!isEncryptedConfig(parsed)) return parsed as Record<string, unknown>;
  const password = getEncryptionPassword();
  return password
    ? JSON.parse(decryptConfig(raw, password)) as Record<string, unknown>
    : null;
}

function loadFullConfig(): ImporterConfig | null {
  try {
    const config = readJsonOrEncrypted('/app/config.json');
    if (!config) return null;
    const creds = readJsonOrEncrypted('/app/credentials.json');
    return (creds ? { ...config, ...creds } : config) as unknown as ImporterConfig;
  } catch { return null; }
}

function loadLogConfig(): LogConfig | undefined {
  const config = loadFullConfig();
  if (!config) return undefined;
  const tg = config.notifications?.telegram;
  const hasBot = tg?.listenForCommands === true;
  const format = config.logConfig?.format ?? deriveLogFormat(tg?.messageFormat, hasBot);
  const logDir = config.logConfig?.logDir ?? DEFAULT_LOG_DIR;
  return { ...config.logConfig, format, maxBufferSize: 0, logDir };
}


// ─── Import execution ───

function runLocked(importFn: () => Promise<number>): Promise<number> {
  if (activeImport) { logger.warn('⚠️  Import already running, skipping'); return activeImport; }
  activePoller?.stop();
  activeImport = importFn().finally(() => {
    activeImport = null;
    activePoller?.start().catch(() => {});
  });
  return activeImport;
}

function runImportLocked(banks?: string[]): Promise<number> {
  const extraEnv: Record<string, string> = banks?.length ? { IMPORT_BANKS: banks.join(',') } : {};
  return runLocked(() => runImport(extraEnv));
}
function runPreviewLocked(): Promise<number> {
  return runLocked(() => runImport({ DRY_RUN: 'true' }));
}

function runImport(extraEnv: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve) => {
    const startTime = new Date();
    logger.info(`\n⏰ ${startTime.toISOString()}: Starting import...`);
    const env = Object.keys(extraEnv).length > 0 ? { ...process.env, ...extraEnv } : process.env;
    const child: ChildProcess = spawn('node', ['/app/dist/index.js'], { stdio: 'inherit', env });
    child.on('exit', (code) => { logImportResult(code, startTime); resolve(code || 0); });
    child.on('error', (err) => {
      logger.error(`❌ Failed to start import: ${err.message}`);
      resolve(1);
    });
  });
}

function logImportResult(code: number | null, startTime: Date): void {
  const duration = Math.round((Date.now() - startTime.getTime()) / 1000);
  const time = new Date().toISOString();
  if (code === 0) {
    logger.info(`✅ ${time}: Import completed successfully (took ${duration}s)`);
  } else {
    logger.error(`❌ ${time}: Import failed with exit code ${code} (took ${duration}s)`);
  }
}

// ─── Telegram commands ───

function logCommandCount(extras: Array<{ command: string; description: string }>): void {
  const cmdNames = extras.map(c => c.command).join(', /');
  logger.info(
    `📋 Registering ${4 + extras.length} bot commands` +
    (extras.length ? ` (including /${cmdNames})` : '')
  );
}

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

function buildCommandHandler(notifier: TelegramNotifier): TelegramCommandHandler {
  return new TelegramCommandHandler({
    runImport: runImportLocked, notifier, auditLog: new AuditLogService(),
    runValidate: runConfigValidation,
    runPreview: runPreviewLocked,
    getBankNames: () => Object.keys(loadFullConfig()?.banks ?? {}),
    logDir: logConfig?.logDir,
  });
}

async function createHandlerAndPoller(
  telegram: TelegramConfig, config: ImporterConfig | null
): Promise<void> {
  const notifier = new TelegramNotifier(telegram);
  const extras = buildExtraCommands(config);
  logCommandCount(extras);
  await notifier.registerCommands(extras);
  const handler = buildCommandHandler(notifier);
  activePoller = new TelegramPoller(
    telegram.botToken, telegram.chatId, (text) => handler.handle(text)
  );
  activePoller.start().catch((err: unknown) => {
    logger.error(`Telegram command listener crashed: ${errorMessage(err)}`);
  });
}

async function startTelegramCommands(): Promise<void> {
  const config = loadFullConfig();
  const telegram = config?.notifications?.enabled ? config.notifications.telegram : null;
  if (!telegram?.listenForCommands) return;
  try {
    await createHandlerAndPoller(telegram, config);
  } catch (error: unknown) {
    logger.error(`⚠️  Failed to start Telegram commands: ${errorMessage(error)}`);
  }
}

function buildExtraCommands(
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

function safeSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.min(ms, MAX_TIMEOUT_MS)));
}

async function scheduleLoop(schedule: string): Promise<never> {
  while (true) {
    try {
      const interval = CronExpressionParser.parse(schedule, { tz: process.env.TZ || 'UTC' });
      const nextRun = interval.next().toDate();
      const msUntilNext = nextRun.getTime() - Date.now();
      const minutesUntil = Math.round(msUntilNext / 1000 / 60);
      logger.info(`⏳ Waiting until ${nextRun.toISOString()} (${minutesUntil} minutes)`);
      await safeSleep(msUntilNext);
      if (Date.now() < nextRun.getTime()) continue; // Woke early, re-check
      await runImportLocked();
    } catch (err: unknown) {
      logger.error(`❌ Scheduler error: ${errorMessage(err)}`);
      await safeSleep(60000);
    }
  }
}

async function main(): Promise<void> {
  await startTelegramCommands();
  const schedule = process.env.SCHEDULE;
  if (!schedule) {
    logger.info('📝 Running once (no SCHEDULE set)');
    process.exit(await runImportLocked());
  }
  logger.info(`⏰ Scheduled mode enabled: ${schedule}`);
  logger.info('💡 Import will run according to cron schedule\n');
  validateSchedule(schedule);
  await scheduleLoop(schedule);
}

main().catch(err => {
  logger.error(`❌ Fatal error: ${errorMessage(err)}`);
  process.exit(1);
});
