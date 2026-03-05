/**
 * Reads recent log entries from rotating log files for the /logs Telegram command.
 * Files are NDJSON (one JSON object per line); each line is formatted as
 * [HH:MM:SS] LEVEL  message for Telegram display.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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

/** Reads formatted log entries from rotating NDJSON log files. */
export class LogFileReader {
  /**
   * Creates a LogFileReader targeting the given log directory.
   * @param logDir - Path to the directory containing rotating log files.
   */
  constructor(private readonly logDir: string) {}

  /**
   * Returns the most recent log entries across all log files.
   * @param count - Maximum number of entries to return.
   * @returns Formatted log lines, oldest first.
   */
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

  /**
   * Lists log files in the log directory sorted newest-first.
   * @returns Array of absolute file paths to log files.
   */
  private sortedFiles(): string[] {
    if (!existsSync(this.logDir)) return [];
    return readdirSync(this.logDir)
      .filter(f => /^app\.\d{4}-\d{2}-\d{2}/.test(f) && f.endsWith('.log'))
      .sort()
      .reverse()
      .map(f => join(this.logDir, f));
  }

  /**
   * Reads the last n formatted lines from a single log file.
   * @param filePath - Absolute path to the log file.
   * @param count - Maximum number of lines to read from the tail.
   * @returns Formatted log lines, skipping unparseable entries.
   */
  private tailFile(filePath: string, count: number): string[] {
    const raw = readFileSync(filePath, 'utf8');
    return raw.split('\n')
      .filter(l => l.trim().length > 0)
      .slice(-count)
      .map(l => this.formatLine(l))
      .filter((l): l is string => l !== null);
  }

  /**
   * Parses one NDJSON line into a human-readable [HH:MM:SS] LEVEL msg string.
   * @param json - Raw NDJSON log line to parse.
   * @returns Formatted string, or null if the line cannot be parsed.
   */
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
