/**
 * Writable stream that rotates log files at 10 MB and on day boundaries.
 * pino writes raw JSON chunks; this stream handles file management transparently.
 */
import { Writable, type TransformCallback } from 'stream';
import { createWriteStream, mkdirSync, type WriteStream } from 'fs';
import { join } from 'path';
import { cleanOldLogs } from './LogCleanup.js';
import { formatDate } from '../Utils/Index.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function dateString(): string {
  return formatDate(new Date()); // YYYY-MM-DD in Israel local time
}

function fileName(date: string, suffix: number): string {
  return suffix === 0 ? `app.${date}.log` : `app.${date}.${suffix}.log`;
}

export class LogRotatingStream extends Writable {
  private currentStream: WriteStream;
  private currentSize = 0;
  private currentDate: string;
  private suffix = 0;

  constructor(private readonly logDir: string) {
    super();
    mkdirSync(logDir, { recursive: true });
    this.currentDate = dateString();
    this.currentStream = this.openFile(this.currentDate, 0);
  }

  _write(chunk: Buffer, _encoding: string, callback: TransformCallback): void {
    this.maybeRotate(chunk.length);
    this.currentSize += chunk.length;
    this.currentStream.write(chunk, callback);
  }

  private maybeRotate(incomingSize: number): void {
    const today = dateString();
    if (today !== this.currentDate) {
      this.openFile(today, 0);
      cleanOldLogs(this.logDir);
    } else if (this.currentSize + incomingSize > MAX_FILE_SIZE) {
      this.openFile(today, this.suffix + 1);
    }
  }

  private openFile(date: string, suffix: number): WriteStream {
    this.currentStream?.end();
    this.currentDate = date;
    this.suffix = suffix;
    this.currentSize = 0;
    const path = join(this.logDir, fileName(date, suffix));
    this.currentStream = createWriteStream(path, { flags: 'a' });
    return this.currentStream;
  }
}
