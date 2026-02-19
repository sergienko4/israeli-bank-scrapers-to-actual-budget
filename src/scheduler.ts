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

console.log('🚀 Israeli Bank Importer Scheduler Starting...');
console.log(`📅 Timezone: ${process.env.TZ || 'UTC'}`);

function runImport(): Promise<number> {
  return new Promise((resolve) => {
    const startTime = new Date();
    console.log(`\n⏰ ${startTime.toISOString()}: Starting import...`);

    const child: ChildProcess = spawn('node', ['/app/dist/index.js'], {
      stdio: 'inherit',
      env: process.env
    });

    child.on('exit', (code) => {
      const endTime = new Date();
      const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000);

      if (code === 0) {
        console.log(`✅ ${endTime.toISOString()}: Import completed successfully (took ${duration}s)`);
      } else {
        console.error(`❌ ${endTime.toISOString()}: Import failed with exit code ${code} (took ${duration}s)`);
      }

      resolve(code || 0);
    });

    child.on('error', (err) => {
      console.error(`❌ Failed to start import: ${err.message}`);
      resolve(1);
    });
  });
}

function startTelegramCommands(): void {
  const configPath = '/app/config.json';
  if (!existsSync(configPath)) return;

  try {
    const config: ImporterConfig = JSON.parse(readFileSync(configPath, 'utf8'));
    const telegram = config.notifications?.telegram;

    if (!config.notifications?.enabled || !telegram?.listenForCommands) return;

    const notifier = new TelegramNotifier(telegram);
    const handler = new TelegramCommandHandler(runImport, notifier);
    const poller = new TelegramPoller(
      telegram.botToken,
      telegram.chatId,
      (text) => handler.handle(text)
    );

    poller.start().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Telegram command listener crashed:', msg);
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('⚠️  Failed to start Telegram commands:', msg);
  }
}

async function main(): Promise<void> {
  const schedule = process.env.SCHEDULE;

  // Start Telegram command listener (if configured)
  startTelegramCommands();

  if (!schedule) {
    console.log('📝 Running once (no SCHEDULE set)');
    const exitCode = await runImport();
    process.exit(exitCode);
  } else {
    console.log(`⏰ Scheduled mode enabled: ${schedule}`);
    console.log('💡 Import will run according to cron schedule\n');

    try {
      const interval = parser.parseExpression(schedule, {
        tz: process.env.TZ || 'UTC'
      });

      console.log(`📅 Next scheduled run: ${interval.next().toString()}`);
    } catch (err: unknown) {
      console.error(`❌ Invalid SCHEDULE format: ${err instanceof Error ? err.message : String(err)}`);
      console.error('   Example: "0 */8 * * *" (every 8 hours)');
      process.exit(1);
    }

    while (true) {
      try {
        const interval = parser.parseExpression(schedule, {
          tz: process.env.TZ || 'UTC'
        });

        const nextRun = interval.next().toDate();
        const now = new Date();
        const msUntilNext = nextRun.getTime() - now.getTime();

        console.log(`⏳ Waiting until ${nextRun.toISOString()} (${Math.round(msUntilNext / 1000 / 60)} minutes)`);

        await new Promise(resolve => setTimeout(resolve, msUntilNext));
        await runImport();

      } catch (err: unknown) {
        console.error(`❌ Scheduler error: ${err instanceof Error ? err.message : String(err)}`);
        await new Promise(resolve => setTimeout(resolve, 60000));
      }
    }
  }
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
