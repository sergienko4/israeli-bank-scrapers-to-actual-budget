/**
 * TelegramCommandHandler - Handles bot commands
 * Commands: /scan, /import, /status, /help
 */

import { INotifier } from './notifications/INotifier.js';

export class TelegramCommandHandler {
  private importPromise: Promise<void> | null = null;
  private lastRunTime: Date | null = null;
  private lastRunResult: string | null = null;

  constructor(
    private runImport: () => Promise<number>,
    private notifier: INotifier
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
    if (this.importPromise) {
      await this.reply('⏳ Import already running. Please wait.');
      return;
    }

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
      : 'No imports run yet'
    );

    lines.push(`Currently: ${this.importPromise ? '⏳ importing...' : '✅ idle'}`);
    await this.reply(lines.join('\n'));
  }

  private async handleHelp(): Promise<void> {
    const lines = [
      '🤖 <b>Available Commands</b>',
      '',
      '/scan - Run bank import now',
      '/status - Show last run info',
      '/help - Show this message',
    ];
    await this.reply(lines.join('\n'));
  }

  private async reply(text: string): Promise<void> {
    try {
      await this.notifier.sendMessage(text);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.debug('Failed to send reply:', msg);
    }
  }

  private timeSince(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h`;
  }
}
