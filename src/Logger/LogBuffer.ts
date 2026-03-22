/**
 * Circular ring buffer for storing recent log entries
 * O(1) add, used by /logs bot command to show recent activity
 *
 * maxSize=0 disables buffering (zero memory overhead)
 * Buffer only enabled when listenForCommands is true
 */

const DEFAULT_MAX_SIZE = 0;
const MAX_ALLOWED_SIZE = 500;

/** O(1) circular ring buffer for storing recent log entries. */
export default class LogBuffer {
  private _entries: string[];
  private _writeIndex = 0;
  private _count = 0;
  private readonly _maxSize: number;

  /**
   * Creates a LogBuffer with the given maximum capacity.
   * @param maxSize - Maximum entries to retain; 0 disables buffering.
   */
  constructor(maxSize?: number) {
    const clampedSize = Math.min(maxSize ?? DEFAULT_MAX_SIZE, MAX_ALLOWED_SIZE);
    this._maxSize = Math.max(0, clampedSize);
    this._entries = this._maxSize > 0 ? new Array<string>(this._maxSize) : [];
  }

  /**
   * Appends a log line to the buffer, evicting the oldest entry when full.
   * @param line - The log line string to store.
   */
  public add(line: string): void {
    if (this._maxSize === 0) return;
    this._entries[this._writeIndex] = line;
    this._writeIndex = (this._writeIndex + 1) % this._maxSize;
    if (this._count < this._maxSize) this._count++;
  }

  /**
   * Returns the most recent log entries up to the requested count.
   * @param count - Maximum number of entries to return; defaults to all stored entries.
   * @returns Array of log line strings, oldest first.
   */
  public getRecent(count?: number): string[] {
    const n = Math.min(count ?? this._count, this._count);
    if (n === 0) return [];
    const start = (this._writeIndex - n + this._maxSize) % this._maxSize;
    return this.readFromIndex(start, n);
  }

  /**
   * Returns the current number of stored entries.
   * @returns Number of entries currently in the buffer.
   */
  public size(): number {
    return this._count;
  }

  /** Resets the buffer to an empty state, discarding all stored entries. */
  public clear(): void {
    if (this._maxSize === 0) return;
    this._entries = new Array<string>(this._maxSize);
    this._writeIndex = 0;
    this._count = 0;
  }

  /**
   * Indicates whether buffering is active (maxSize > 0).
   * @returns True when the buffer has a non-zero capacity.
   */
  public isEnabled(): boolean {
    return this._maxSize > 0;
  }

  /**
   * Reads n entries starting from a given index, wrapping around the ring.
   * @param start - Ring index from which to begin reading.
   * @param n - Number of entries to read.
   * @returns Array of log line strings in chronological order.
   */
  private readFromIndex(start: number, n: number): string[] {
    const result: string[] = [];
    for (let i = 0; i < n; i++) {
      result.push(this._entries[(start + i) % this._maxSize]);
    }
    return result;
  }
}
