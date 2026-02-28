/**
 * TelegramCommandHandler - Handles bot commands
 * Commands: /scan, /import, /status, /watch, /logs, /help
 */

import { INotifier } from './Notifications/INotifier.js';
import { IAuditLog, AuditEntry } from './AuditLogService.js';
import { errorMessage } from '../Utils/index.js';
import { getLogger, getLogBuffer } from '../Logger/index.js';

const MAX_TELEGRAM_LENGTH = 4096;
const DEFAULT_LOG_COUNT = 50;

export interface CommandHandlerOptions {
  runImport: () => Promise<number>;
  notifier: INotifier;
  auditLog?: IAuditLog;
  runWatch?: () => Promise<string | null>;
  runValidate?: () => Promise<string>;
  runPreview?: () => Promise<number>;
}

export class TelegramCommandHandler {
  private runImport: () => Promise<number>;
  private notifier: INotifier;
  private auditLog?: IAuditLog;
  private runWatch?: () => Promise<string | null>;
  private runValidate?: () => Promise<string>;
  private runPreview?: () => Promise<number>;
  private importPromise: Promise<void> | null = null;
  private lastRunTime: Date | null = null;
  private lastRunResult: string | null = null;

  constructor(opts: CommandHandlerOptions) {
    this.runImport = opts.runImport;
    this.notifier = opts.notifier;
    this.auditLog = opts.auditLog;
    this.runWatch = opts.runWatch;
    this.runValidate = opts.runValidate;
    this.runPreview = opts.runPreview;
  }

  async handle(text: string): Promise<void> {
    const parts = text.trim().toLowerCase().split(' ');
    const command = parts[0];
    const handlers: Record<string, () => Promise<void>> = {
      '/scan': () => this.handleScan(),
      '/import': () => this.handleScan(),
      '/status': () => this.handleStatus(),
      '/logs': () => this.handleLogs(parts[1]),
      '/watch': () => this.handleWatch(),
      '/check_config': () => this.handleCheckConfig(),
      '/preview': () => this.handlePreview(),
      '/help': () => this.handleHelp(),
      '/start': () => this.handleHelp(),
    };
    const handler = handlers[command];
    if (handler) await handler();
  }

  private async handleScan(): Promise<void> {
    if (this.importPromise) { await this.reply('⏳ Import already running. Please wait.'); return; }
    this.importPromise = this.executeImport();
    await this.importPromise;
  }

  private async executeImport(): Promise<void> {
    await this.reply('⏳ Starting import...');
    const start = Date.now();
    try {
      const exitCode = await this.runImport();
      const dur = ((Date.now() - start) / 1000).toFixed(0);
      this.lastRunTime = new Date();
      this.lastRunResult = exitCode === 0 ? 'success' : 'failed';
      if (exitCode !== 0) {
        await this.reply(this.buildErrorReply(dur));
      }
    } finally {
      this.importPromise = null;
    }
  }

  private buildErrorReply(dur: string): string {
    const entry = this.auditLog?.getRecent(1)[0];
    if (!entry || entry.failedBanks === 0) {
      return `❌ Import failed (${dur}s). Use /logs for details.`;
    }
    const failed = entry.banks.filter(b => b.status === 'failed');
    const header = `❌ Import failed (${dur}s) — ` +
      `${entry.failedBanks}/${entry.totalBanks} banks had errors:`;
    const lines = [header];
    for (const b of failed) {
      lines.push(`• ${b.name}${b.error ? `: ${b.error.slice(0, 80)}` : ''}`);
    }
    lines.push('', 'Use /logs for details or /status for history.');
    return lines.join('\n');
  }

  private async handleStatus(): Promise<void> {
    const lines: string[] = ['📊 <b>Status</b>', ''];
    lines.push(this.lastRunTime
      ? `Last run: ${this.timeSince(this.lastRunTime)} ago (${this.lastRunResult})`
      : 'No imports run yet');
    lines.push(`Currently: ${this.importPromise ? '⏳ importing...' : '✅ idle'}`);
    this.appendRecentHistory(lines);
    await this.reply(lines.join('\n'));
  }

  private appendRecentHistory(lines: string[]): void {
    if (!this.auditLog) return;
    const recent = this.auditLog.getRecent(5);
    if (recent.length === 0) return;
    lines.push('', '<b>Recent imports:</b>');
    recent.reverse().forEach(e => lines.push(this.formatAuditEntry(e)));
  }

  private formatAuditEntry(entry: AuditEntry): string {
    const date = entry.timestamp.split('T')[0];
    const time = entry.timestamp.split('T')[1]?.slice(0, 5) || '';
    const dur = `${(entry.totalDuration / 1000).toFixed(0)}s`;
    const icon = entry.failedBanks === 0 ? '✅' : '⚠️';
    return (
      `${icon} ${date} ${time} — ` +
      `${entry.totalTransactions} txns, ${entry.successfulBanks}/${entry.totalBanks} banks, ${dur}`
    );
  }

  private async handleLogs(countArg?: string): Promise<void> {
    const buffer = getLogBuffer();
    if (!buffer.isEnabled()) {
      await this.reply('📋 Log buffer disabled. Set logConfig.maxBufferSize > 0 in config.json');
      return;
    }
    const entries = buffer.getRecent(this.parseLogCount(countArg));
    if (entries.length === 0) { await this.reply('📋 No log entries yet.'); return; }
    const header = `📋 <b>Recent Logs</b> (${entries.length} entries)\n\n<pre>`;
    const footer = '</pre>';
    const body = this.truncateForTelegram(entries, header.length + footer.length);
    await this.reply(header + body + footer);
  }

  private parseLogCount(arg?: string): number {
    if (!arg) return DEFAULT_LOG_COUNT;
    const n = parseInt(arg, 10);
    return isNaN(n) ? DEFAULT_LOG_COUNT : Math.min(Math.max(n, 1), 150);
  }

  private truncateForTelegram(entries: string[], reservedLength: number): string {
    const maxLength = MAX_TELEGRAM_LENGTH - reservedLength - 20;
    const text = entries.join('\n');
    if (text.length <= maxLength) return text;
    const trimmed = text.slice(-maxLength);
    const firstNewline = trimmed.indexOf('\n');
    const clean = firstNewline > 0 ? trimmed.slice(firstNewline + 1) : trimmed;
    return '...(earlier entries omitted)\n' + clean;
  }

  private async handleWatch(): Promise<void> {
    if (!this.runWatch) {
      await this.reply(
        '🔔 Spending watch runs automatically after each import.\n' +
        'On-demand /watch is coming soon.\n\n' +
        'Use /scan to trigger an import with spending watch.'
      );
      return;
    }
    await this.reply('🔍 Checking spending rules...');
    try {
      const message = await this.runWatch();
      await this.reply(message ?? '✅ All spending within limits.');
    } catch (error: unknown) {
      await this.reply(`❌ Watch error: ${errorMessage(error)}`);
    }
  }

  private async handleCheckConfig(): Promise<void> {
    if (!this.runValidate) {
      await this.reply('⚙️ Config validation unavailable.');
      return;
    }
    await this.reply('🔍 Validating configuration...');
    try {
      const report = await this.runValidate();
      await this.reply(`<pre>${report}</pre>`);
    } catch (error: unknown) {
      await this.reply(`❌ Validation error: ${errorMessage(error)}`);
    }
  }

  private async handlePreview(): Promise<void> {
    if (!this.runPreview) {
      await this.reply('🔍 Preview mode unavailable.');
      return;
    }
    if (this.importPromise) { await this.reply('⏳ Import already running. Please wait.'); return; }
    await this.reply('🔍 Starting dry run — no changes will be made...');
    this.importPromise = this.executePreview(this.runPreview);
    await this.importPromise;
  }

  private async executePreview(run: () => Promise<number>): Promise<void> {
    const start = Date.now();
    try {
      await run();
      const dur = ((Date.now() - start) / 1000).toFixed(0);
      await this.reply(`✅ Dry run completed (${dur}s). See preview report above.`);
    } catch (error: unknown) {
      await this.reply(`❌ Preview error: ${errorMessage(error)}`);
    } finally {
      this.importPromise = null;
    }
  }

  private async handleHelp(): Promise<void> {
    const lines = [
      '🤖 <b>Available Commands</b>', '',
      '/scan - Run bank import now',
      '/preview - Dry run: scrape without importing',
      '/status - Show last run info + history',
      '/check_config - Check configuration (offline + online)',
      '/watch - Spending watch info (runs after each import)',
      '/logs - Show recent log entries',
      '/logs 100 - Show last 100 entries (max 150)',
      '/help - Show this message',
    ];
    await this.reply(lines.join('\n'));
  }

  private async reply(text: string): Promise<void> {
    try { await this.notifier.sendMessage(text); }
    catch (error: unknown) {
      getLogger().debug(`Failed to send reply: ${errorMessage(error)}`);
    }
  }

  private timeSince(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h`;
  }
}
