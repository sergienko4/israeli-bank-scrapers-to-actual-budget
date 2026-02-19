/**
 * TelegramCommandHandler - Handles bot commands
 * Commands: /scan, /import, /status, /help
 */

import { INotifier } from './notifications/INotifier.js';
import { IAuditLog, AuditEntry } from './AuditLogService.js';
import { errorMessage } from '../utils/index.js';

export class TelegramCommandHandler {
  private importPromise: Promise<void> | null = null;
  private lastRunTime: Date | null = null;
  private lastRunResult: string | null = null;

  constructor(
    private runImport: () => Promise<number>,
    private notifier: INotifier,
    private auditLog?: IAuditLog
  ) {}

  async handle(text: string): Promise<void> {
    const command = text.trim().toLowerCase().split(' ')[0];
    const handlers: Record<string, () => Promise<void>> = {
      '/scan': () => this.handleScan(),
      '/import': () => this.handleScan(),
      '/status': () => this.handleStatus(),
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
    try {
      const exitCode = await this.runImport();
      this.lastRunTime = new Date();
      this.lastRunResult = exitCode === 0 ? 'success' : 'failed';
    } finally {
      this.importPromise = null;
    }
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
    const recent = this.auditLog.getRecent(3);
    if (recent.length === 0) return;
    lines.push('', '<b>Recent imports:</b>');
    recent.reverse().forEach(e => lines.push(this.formatAuditEntry(e)));
  }

  private formatAuditEntry(entry: AuditEntry): string {
    const date = entry.timestamp.split('T')[0];
    const time = entry.timestamp.split('T')[1]?.slice(0, 5) || '';
    const icon = entry.failedBanks === 0 ? '✅' : '⚠️';
    return `${icon} ${date} ${time} — ${entry.totalTransactions} txns, ${entry.successfulBanks}/${entry.totalBanks} banks`;
  }

  private async handleHelp(): Promise<void> {
    const lines = [
      '🤖 <b>Available Commands</b>', '',
      '/scan - Run bank import now',
      '/status - Show last run info + history',
      '/help - Show this message',
    ];
    await this.reply(lines.join('\n'));
  }

  private async reply(text: string): Promise<void> {
    try { await this.notifier.sendMessage(text); }
    catch (error: unknown) { console.debug('Failed to send reply:', errorMessage(error)); }
  }

  private timeSince(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h`;
  }
}
