/**
 * Circular ring buffer for storing recent log entries
 * O(1) add, used by /logs bot command to show recent activity
 *
 * maxSize=0 disables buffering (zero memory overhead)
 * Buffer only enabled when listenForCommands is true
 */

const DEFAULT_MAX_SIZE = 0;
const MAX_ALLOWED_SIZE = 500;

export class LogBuffer {
  private entries: string[];
  private writeIndex = 0;
  private count = 0;
  private readonly maxSize: number;

  constructor(maxSize?: number) {
    this.maxSize = Math.max(0, Math.min(maxSize ?? DEFAULT_MAX_SIZE, MAX_ALLOWED_SIZE));
    this.entries = this.maxSize > 0 ? new Array<string>(this.maxSize) : [];
  }

  add(line: string): void {
    if (this.maxSize === 0) return;
    this.entries[this.writeIndex] = line;
    this.writeIndex = (this.writeIndex + 1) % this.maxSize;
    if (this.count < this.maxSize) this.count++;
  }

  getRecent(count?: number): string[] {
    const n = Math.min(count ?? this.count, this.count);
    if (n === 0) return [];
    const start = (this.writeIndex - n + this.maxSize) % this.maxSize;
    return this.readFromIndex(start, n);
  }

  size(): number {
    return this.count;
  }

  clear(): void {
    if (this.maxSize === 0) return;
    this.entries = new Array<string>(this.maxSize);
    this.writeIndex = 0;
    this.count = 0;
  }

  isEnabled(): boolean {
    return this.maxSize > 0;
  }

  private readFromIndex(start: number, n: number): string[] {
    const result: string[] = [];
    for (let i = 0; i < n; i++) {
      result.push(this.entries[(start + i) % this.maxSize]);
    }
    return result;
  }
}
