/**
 * Ring buffer for storing recent log entries
 * Used by /logs bot command to show recent activity
 */

const DEFAULT_MAX_SIZE = 150;

export class LogBuffer {
  private entries: string[] = [];
  private readonly maxSize: number;

  constructor(maxSize?: number) {
    this.maxSize = Math.max(1, Math.min(maxSize ?? DEFAULT_MAX_SIZE, 500));
  }

  add(line: string): void {
    this.entries.push(line);
    if (this.entries.length > this.maxSize) this.entries.shift();
  }

  getRecent(count?: number): string[] {
    const n = Math.min(count ?? this.maxSize, this.entries.length);
    return this.entries.slice(-n);
  }

  size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries = [];
  }
}
