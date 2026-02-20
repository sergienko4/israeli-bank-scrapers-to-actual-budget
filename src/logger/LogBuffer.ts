/**
 * Circular ring buffer for storing recent log entries
 * O(1) add, used by /logs bot command to show recent activity
 */

const DEFAULT_MAX_SIZE = 150;

export class LogBuffer {
  private entries: string[];
  private writeIndex = 0;
  private count = 0;
  private readonly maxSize: number;

  constructor(maxSize?: number) {
    this.maxSize = Math.max(1, Math.min(maxSize ?? DEFAULT_MAX_SIZE, 500));
    this.entries = new Array<string>(this.maxSize);
  }

  add(line: string): void {
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
    this.entries = new Array<string>(this.maxSize);
    this.writeIndex = 0;
    this.count = 0;
  }

  private readFromIndex(start: number, n: number): string[] {
    const result: string[] = [];
    for (let i = 0; i < n; i++) {
      result.push(this.entries[(start + i) % this.maxSize]);
    }
    return result;
  }
}
