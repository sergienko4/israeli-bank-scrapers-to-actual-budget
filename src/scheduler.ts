/**
 * Scheduler for running imports on a cron schedule
 * Optionally listens for Telegram commands (/scan, /status, /help)
 */

import { spawn, ChildProcess } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import parser from 'cron-parser';
import { TelegramPoller } from './services/TelegramPoller.js';
import { TelegramCommandHandler } from './services/TelegramCommandHandler.js';
import { TelegramNotifier } from './services/notifications/TelegramNotifier.js';
import { ImporterConfig } from './types/index.js';
import { errorMessage } from './utils/index.js';

console.log('🚀 Israeli Bank Importer Scheduler Starting...');
console.log(`📅 Timezone: ${process.env.TZ || 'UTC'}`);

let activeImport: Promise<number> | null = null;
let activePoller: TelegramPoller | null = null;

// ─── Import execution ───

function runImportLocked(): Promise<number> {
  if (activeImport) { console.log('⚠️  Import already running, skipping'); return activeImport; }
  activePoller?.stop();
  activeImport = runImport().finally(() => {
    activeImport = null;
    activePoller?.start().catch(() => {});
  });
  return activeImport;
}

function runImport(): Promise<number> {
  return new Promise((resolve) => {
    const startTime = new Date();
    console.log(`\n⏰ ${startTime.toISOString()}: Starting import...`);
    const child: ChildProcess = spawn('node', ['/app/dist/index.js'], { stdio: 'inherit', env: process.env });
    child.on('exit', (code) => { logImportResult(code, startTime); resolve(code || 0); });
    child.on('error', (err) => { console.error(`❌ Failed to start import: ${err.message}`); resolve(1); });
  });
}

function logImportResult(code: number | null, startTime: Date): void {
  const duration = Math.round((Date.now() - startTime.getTime()) / 1000);
  const time = new Date().toISOString();
  if (code === 0) console.log(`✅ ${time}: Import completed successfully (took ${duration}s)`);
  else console.error(`❌ ${time}: Import failed with exit code ${code} (took ${duration}s)`);
}

// ─── Telegram commands ───

function loadTelegramConfig(): ImporterConfig['notifications'] | null {
  const configPath = '/app/config.json';
  if (!existsSync(configPath)) return null;
  try {
    const config: ImporterConfig = JSON.parse(readFileSync(configPath, 'utf8'));
    return config.notifications?.enabled ? config.notifications : null;
  } catch { return null; }
}

function startTelegramCommands(): void {
  const notifications = loadTelegramConfig();
  const telegram = notifications?.telegram;
  if (!telegram?.listenForCommands) return;

  try {
    const notifier = new TelegramNotifier(telegram);
    const handler = new TelegramCommandHandler(runImportLocked, notifier);
    activePoller = new TelegramPoller(telegram.botToken, telegram.chatId, (text) => handler.handle(text));
    activePoller.start().catch((err: unknown) => {
      console.error('Telegram command listener crashed:', errorMessage(err));
    });
  } catch (error: unknown) {
    console.error('⚠️  Failed to start Telegram commands:', errorMessage(error));
  }
}

// ─── Scheduling ───

function validateSchedule(schedule: string): void {
  try {
    const interval = parser.parseExpression(schedule, { tz: process.env.TZ || 'UTC' });
    console.log(`📅 Next scheduled run: ${interval.next().toString()}`);
  } catch (err: unknown) {
    console.error(`❌ Invalid SCHEDULE format: ${errorMessage(err)}`);
    console.error('   Example: "0 */8 * * *" (every 8 hours)');
    process.exit(1);
  }
}

async function scheduleLoop(schedule: string): Promise<never> {
  while (true) {
    try {
      const interval = parser.parseExpression(schedule, { tz: process.env.TZ || 'UTC' });
      const nextRun = interval.next().toDate();
      const msUntilNext = nextRun.getTime() - Date.now();
      console.log(`⏳ Waiting until ${nextRun.toISOString()} (${Math.round(msUntilNext / 1000 / 60)} minutes)`);
      await new Promise(resolve => setTimeout(resolve, msUntilNext));
      await runImportLocked();
    } catch (err: unknown) {
      console.error(`❌ Scheduler error: ${errorMessage(err)}`);
      await new Promise(resolve => setTimeout(resolve, 60000));
    }
  }
}

async function main(): Promise<void> {
  startTelegramCommands();
  const schedule = process.env.SCHEDULE;
  if (!schedule) {
    console.log('📝 Running once (no SCHEDULE set)');
    process.exit(await runImport());
  }
  console.log(`⏰ Scheduled mode enabled: ${schedule}`);
  console.log('💡 Import will run according to cron schedule\n');
  validateSchedule(schedule);
  await scheduleLoop(schedule);
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
