/**
 * Reads recent log entries from rotating log files for the /logs Telegram command.
 * Files are NDJSON (one JSON object per line); each line is formatted as
 * [HH:MM:SS] LEVEL  message for Telegram display.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

interface PinoEntry {
  time: number;
  level: number;
  msg: string;
}

const LEVEL_LABELS: Record<number, string> = {
  20: 'DEBUG',
  30: 'INFO ',
  40: 'WARN ',
  50: 'ERROR',
};

export class LogFileReader {
  constructor(private readonly logDir: string) {}

  getRecent(count: number): string[] {
    const files = this.sortedFiles();
    const result: string[] = [];
    for (const file of files) {
      if (result.length >= count) break;
      const lines = this.tailFile(file, count - result.length);
      result.unshift(...lines);
    }
    return result;
  }

  private sortedFiles(): string[] {
    if (!existsSync(this.logDir)) return [];
    return readdirSync(this.logDir)
      .filter(f => /^app\.\d{4}-\d{2}-\d{2}/.test(f) && f.endsWith('.log'))
      .sort()
      .reverse()
      .map(f => join(this.logDir, f));
  }

  private tailFile(filePath: string, count: number): string[] {
    const raw = readFileSync(filePath, 'utf8');
    return raw.split('\n')
      .filter(l => l.trim().length > 0)
      .slice(-count)
      .map(l => this.formatLine(l))
      .filter((l): l is string => l !== null);
  }

  private formatLine(json: string): string | null {
    try {
      const entry = JSON.parse(json) as PinoEntry;
      const time = new Date(entry.time).toTimeString().slice(0, 8);
      const level = LEVEL_LABELS[entry.level] ?? 'INFO ';
      return `[${time}] ${level} ${entry.msg}`;
    } catch {
      return null;
    }
  }
}
