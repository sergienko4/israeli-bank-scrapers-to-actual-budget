/**
 * Removes log files older than 3 days from the log directory.
 * Called at app startup and by LogRotatingStream on day rollover.
 */
import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import type { Procedure } from '../Types/Index.js';
import { succeed } from '../Types/Index.js';

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Removes log files older than 3 days from the log directory.
 * @param logDir - Path to the directory containing log files to clean.
 * @returns Procedure indicating the cleanup completed.
 */
export default function cleanOldLogs(
  logDir: string
): Procedure<{ status: string }> {
  if (!existsSync(logDir)) return succeed({ status: 'no-dir' });
  const cutoff = new Date(Date.now() - THREE_DAYS_MS);
  for (const file of readdirSync(logDir)) {
    const match = /^app\.(\d{4}-\d{2}-\d{2})/.exec(file);
    if (!match || new Date(match[1]) >= cutoff) continue;
    const filePath = join(logDir, file);
    try { unlinkSync(filePath); } catch { /* skip locked files */ }
  }
  return succeed({ status: 'cleaned' });
}
