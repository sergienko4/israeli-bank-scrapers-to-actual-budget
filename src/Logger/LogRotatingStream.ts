/**
 * Writable stream that rotates log files at 10 MB and on day boundaries.
 * pino writes raw JSON chunks; this stream handles file management transparently.
 */
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { type TransformCallback,Writable } from 'node:stream';

import { formatDate } from '../Utils/Index.js';
import cleanOldLogs from './LogCleanup.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Returns today's date as a YYYY-MM-DD string in Israel local time.
 * @returns YYYY-MM-DD date string for the current day.
 */
function dateString(): string {
  return formatDate(new Date()); // YYYY-MM-DD in Israel local time
}

/**
 * Builds the log file name for a given date and rotation suffix.
 * @param date - YYYY-MM-DD date string used as part of the filename.
 * @param suffix - Rotation index within the day; 0 omits the suffix.
 * @returns Log filename like `app.2026-01-01.log` or `app.2026-01-01.1.log`.
 */
function fileName(date: string, suffix: number): string {
  return suffix === 0 ? `app.${date}.log` : `app.${date}.${String(suffix)}.log`;
}

/** Writable stream that rotates log files at 10 MB and on day boundaries. */
export default class LogRotatingStream extends Writable {
  private _currentStream: WriteStream;
  private _currentSize = 0;
  private _currentDate: string;
  private _suffix = 0;

  /**
   * Creates a LogRotatingStream writing to the given directory.
   * @param logDir - Absolute path to the directory for log files.
   */
  constructor(private readonly logDir: string) {
    super({
      /**
       * Writes a chunk to the current log file, rotating first if needed.
       * @param chunk - Raw data buffer from pino.
       * @param _encoding - Encoding string (unused; pino always passes buffers).
       * @param callback - Node.js stream callback to signal write completion.
       */
      write: (chunk: Buffer, _encoding: string, callback: TransformCallback) => {
        this.maybeRotate(chunk.length);
        this._currentSize += chunk.length;
        this._currentStream.write(chunk, callback);
      },
    });
    mkdirSync(logDir, { recursive: true });
    this._currentDate = dateString();
    const initialFileName = fileName(this._currentDate, 0);
    const path = join(logDir, initialFileName);
    this._currentStream = createWriteStream(path, { flags: 'a' });
  }

  /**
   * Checks whether a day rollover or size limit requires rotating to a new file.
   * @param incomingSize - Byte size of the chunk about to be written.
   */
  private maybeRotate(incomingSize: number): void {
    const today = dateString();
    if (today !== this._currentDate) {
      this.openFile(today, 0);
      cleanOldLogs(this.logDir);
    } else if (this._currentSize + incomingSize > MAX_FILE_SIZE) {
      this.openFile(today, this._suffix + 1);
    }
  }

  /**
   * Opens a new log file for the given date and suffix, closing the current one.
   * @param date - YYYY-MM-DD string for the new file.
   * @param suffix - Rotation index within the day.
   * @returns The newly opened WriteStream.
   */
  private openFile(date: string, suffix: number): WriteStream {
    this._currentStream.end();
    this._currentDate = date;
    this._suffix = suffix;
    this._currentSize = 0;
    const logFileName = fileName(date, suffix);
    const path = join(this.logDir, logFileName);
    this._currentStream = createWriteStream(path, { flags: 'a' });
    return this._currentStream;
  }
}
