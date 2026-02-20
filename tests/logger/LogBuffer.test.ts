import { describe, it, expect, beforeEach } from 'vitest';
import { LogBuffer } from '../../src/logger/LogBuffer.js';

describe('LogBuffer', () => {
  let buffer: LogBuffer;

  beforeEach(() => {
    buffer = new LogBuffer(5);
  });

  it('starts empty', () => {
    expect(buffer.size()).toBe(0);
    expect(buffer.getRecent()).toEqual([]);
  });

  it('adds and retrieves entries', () => {
    buffer.add('line 1');
    buffer.add('line 2');
    expect(buffer.getRecent()).toEqual(['line 1', 'line 2']);
  });

  it('evicts oldest when full', () => {
    for (let i = 1; i <= 7; i++) buffer.add(`line ${i}`);
    expect(buffer.size()).toBe(5);
    expect(buffer.getRecent()).toEqual(['line 3', 'line 4', 'line 5', 'line 6', 'line 7']);
  });

  it('returns last N entries with count param', () => {
    for (let i = 1; i <= 5; i++) buffer.add(`line ${i}`);
    expect(buffer.getRecent(2)).toEqual(['line 4', 'line 5']);
  });

  it('returns all when count exceeds size', () => {
    buffer.add('only');
    expect(buffer.getRecent(100)).toEqual(['only']);
  });

  it('clears all entries', () => {
    buffer.add('line 1');
    buffer.clear();
    expect(buffer.size()).toBe(0);
    expect(buffer.getRecent()).toEqual([]);
  });

  it('defaults to disabled (maxSize=0, zero memory)', () => {
    const defaultBuffer = new LogBuffer();
    expect(defaultBuffer.isEnabled()).toBe(false);
    defaultBuffer.add('ignored');
    expect(defaultBuffer.size()).toBe(0);
    expect(defaultBuffer.getRecent()).toEqual([]);
  });

  it('is enabled when maxSize > 0', () => {
    expect(buffer.isEnabled()).toBe(true);
  });

  it('maxSize=0 is a no-op (zero memory)', () => {
    const disabled = new LogBuffer(0);
    disabled.add('a');
    disabled.add('b');
    expect(disabled.size()).toBe(0);
    expect(disabled.isEnabled()).toBe(false);
  });

  it('clamps max size to 500', () => {
    const huge = new LogBuffer(999);
    for (let i = 0; i < 510; i++) huge.add(`line ${i}`);
    expect(huge.size()).toBe(500);
  });
});
