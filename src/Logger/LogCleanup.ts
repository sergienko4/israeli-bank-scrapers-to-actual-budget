/**
 * Removes log files older than 3 days from the log directory.
 * Called at app startup and by LogRotatingStream on day rollover.
 */
import { existsSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

export function cleanOldLogs(logDir: string): void {
  if (!existsSync(logDir)) return;
  const cutoff = new Date(Date.now() - THREE_DAYS_MS);
  for (const file of readdirSync(logDir)) {
    const match = /^app\.(\d{4}-\d{2}-\d{2})/.exec(file);
    if (!match || new Date(match[1]) >= cutoff) continue;
    try { unlinkSync(join(logDir, file)); } catch { /* skip locked or already-deleted files */ }
  }
}
