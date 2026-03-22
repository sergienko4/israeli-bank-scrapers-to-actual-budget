/**
 * Removes log files older than 3 days from the log directory.
 * Called at app startup and by LogRotatingStream on day rollover.
 */
import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import type { Procedure } from '../Types/Index.js';
import { fail, isFail, succeed } from '../Types/Index.js';
import { errorMessage } from '../Utils/Index.js';

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const LOCKED_FILE_CODES = new Set(['EBUSY', 'EPERM']);

/**
 * Checks whether a file-system error is a locked-file error (EBUSY/EPERM).
 * @param error - The caught error value.
 * @returns True if the error code indicates a locked file.
 */
function isLockedFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code ?? '';
  return LOCKED_FILE_CODES.has(code);
}

/**
 * Attempts to delete a single log file, warning on non-locked-file errors.
 * @param filePath - Absolute path to the log file to remove.
 * @returns Procedure indicating whether the file was deleted or skipped.
 */
function tryDeleteLogFile(filePath: string): Procedure<{ status: string }> {
  try {
    unlinkSync(filePath);
    return succeed({ status: 'deleted' });
  } catch (error) {
    if (isLockedFileError(error)) {
      return succeed({ status: 'skipped' });
    }
    return fail(`Could not delete ${filePath}: ${errorMessage(error)}`);
  }
}

/**
 * Checks whether a log file is expired and attempts to delete it if so.
 * @param logDir - Directory containing the log file.
 * @param file - The log file name to evaluate and possibly delete.
 * @param cutoff - Files dated before this cutoff will be deleted.
 * @returns Procedure indicating whether the file was processed.
 */
function deleteIfExpired(
  logDir: string, file: string, cutoff: Date
): Procedure<{ status: string }> {
  const match = /^app\.(\d{4}-\d{2}-\d{2})/.exec(file);
  if (!match || new Date(match[1]) >= cutoff) return succeed({ status: 'skipped' });
  const filePath = join(logDir, file);
  const deleteResult = tryDeleteLogFile(filePath);
  if (isFail(deleteResult)) console.warn(`⚠️  ${deleteResult.message}`);
  return deleteResult;
}

/**
 * Iterates over log files in a directory and deletes those older than the cutoff.
 * @param logDir - Directory containing the log files.
 * @param cutoff - Files dated before this cutoff will be deleted.
 * @returns Procedure indicating the files were processed.
 */
function processLogFiles(logDir: string, cutoff: Date): Procedure<{ status: string }> {
  for (const file of readdirSync(logDir)) {
    deleteIfExpired(logDir, file, cutoff);
  }
  return succeed({ status: 'cleaned' });
}

/**
 * Removes log files older than 3 days from the log directory.
 * @param logDir - Path to the directory containing log files to clean.
 * @returns Procedure indicating the cleanup completed.
 */
export default function cleanOldLogs(
  logDir: string
): Procedure<{ status: string }> {
  try {
    if (!existsSync(logDir)) return succeed({ status: 'no-dir' });
    const cutoff = new Date(Date.now() - THREE_DAYS_MS);
    return processLogFiles(logDir, cutoff);
  } catch (error) {
    return fail(`log cleanup failed: ${errorMessage(error)}`);
  }
}
