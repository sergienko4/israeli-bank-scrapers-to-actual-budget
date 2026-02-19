/**
 * TelegramCommandHandler - Handles bot commands
 * Commands: /scan, /import, /status, /help
 */

import { TelegramNotifier } from './notifications/TelegramNotifier.js';

export class TelegramCommandHandler {
  private importing = false;
  private lastRunTime: Date | null = null;
  private lastRunResult: string | null = null;

  constructor(
    private runImport: () => Promise<number>,
    private notifier: TelegramNotifier
  ) {}

  async handle(text: string): Promise<void> {
    const command = text.trim().toLowerCase().split(' ')[0];

    switch (command) {
      case '/scan':
      case '/import':
        return this.handleScan();
      case '/status':
        return this.handleStatus();
      case '/help':
      case '/start':
        return this.handleHelp();
    }
  }

  private async handleScan(): Promise<void> {
    if (this.importing) {
      await this.reply('⏳ Import already running. Please wait.');
      return;
    }

    this.importing = true;
    await this.reply('⏳ Starting import...');

    try {
      const exitCode = await this.runImport();
      this.lastRunTime = new Date();
      this.lastRunResult = exitCode === 0 ? 'success' : 'failed';
    } finally {
      this.importing = false;
    }
  }

  private async handleStatus(): Promise<void> {
    const lines: string[] = ['📊 <b>Status</b>', ''];

    if (this.lastRunTime) {
      const ago = this.timeSince(this.lastRunTime);
      lines.push(`Last run: ${ago} ago (${this.lastRunResult})`);
    } else {
      lines.push('No imports run yet');
    }

    lines.push(`Currently: ${this.importing ? '⏳ importing...' : '✅ idle'}`);
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
    } catch {
      // Non-blocking
    }
  }

  private timeSince(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h`;
  }
}
