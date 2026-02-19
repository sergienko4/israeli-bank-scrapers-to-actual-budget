import { describe, it, expect } from 'vitest';
import { extractQueryData } from '../../src/utils/index.js';

describe('extractQueryData', () => {
  it('extracts numeric data from valid result', () => {
    expect(extractQueryData({ data: 42 }, 0)).toBe(42);
  });

  it('returns fallback for null result', () => {
    expect(extractQueryData(null, 0)).toBe(0);
  });

  it('returns fallback for undefined data', () => {
    expect(extractQueryData({ data: undefined }, 0)).toBe(0);
  });

  it('returns fallback for null data', () => {
    expect(extractQueryData({ data: null }, 'default')).toBe('default');
  });

  it('extracts array data', () => {
    const result = { data: [{ id: 'a' }, { id: 'b' }] };
    expect(extractQueryData(result, [])).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('returns fallback for empty object', () => {
    expect(extractQueryData({}, 99)).toBe(99);
  });

  it('returns zero when data is zero (not fallback)', () => {
    expect(extractQueryData({ data: 0 }, 999)).toBe(0);
  });
});
