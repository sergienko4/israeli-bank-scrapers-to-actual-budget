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
export class LogBuffer {
  private entries: string[];
  private writeIndex = 0;
  private count = 0;
  private readonly maxSize: number;

  /**
   * Creates a LogBuffer with the given maximum capacity.
   * @param maxSize - Maximum entries to retain; 0 disables buffering.
   */
  constructor(maxSize?: number) {
    this.maxSize = Math.max(0, Math.min(maxSize ?? DEFAULT_MAX_SIZE, MAX_ALLOWED_SIZE));
    this.entries = this.maxSize > 0 ? new Array<string>(this.maxSize) : [];
  }

  /**
   * Appends a log line to the buffer, evicting the oldest entry when full.
   * @param line - The log line string to store.
   */
  add(line: string): void {
    if (this.maxSize === 0) return;
    this.entries[this.writeIndex] = line;
    this.writeIndex = (this.writeIndex + 1) % this.maxSize;
    if (this.count < this.maxSize) this.count++;
  }

  /**
   * Returns the most recent log entries up to the requested count.
   * @param count - Maximum number of entries to return; defaults to all stored entries.
   * @returns Array of log line strings, oldest first.
   */
  getRecent(count?: number): string[] {
    const n = Math.min(count ?? this.count, this.count);
    if (n === 0) return [];
    const start = (this.writeIndex - n + this.maxSize) % this.maxSize;
    return this.readFromIndex(start, n);
  }

  /**
   * Returns the current number of stored entries.
   * @returns Number of entries currently in the buffer.
   */
  size(): number {
    return this.count;
  }

  /** Resets the buffer to an empty state, discarding all stored entries. */
  clear(): void {
    if (this.maxSize === 0) return;
    this.entries = new Array<string>(this.maxSize);
    this.writeIndex = 0;
    this.count = 0;
  }

  /**
   * Indicates whether buffering is active (maxSize > 0).
   * @returns True when the buffer has a non-zero capacity.
   */
  isEnabled(): boolean {
    return this.maxSize > 0;
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
      result.push(this.entries[(start + i) % this.maxSize]);
    }
    return result;
  }
}
