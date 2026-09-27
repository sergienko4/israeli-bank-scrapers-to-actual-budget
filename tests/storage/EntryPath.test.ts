/**
 * {@link entryPath}: an entry's path keeps its directory exactly as given.
 */

import { describe, expect, it } from 'vitest';

import entryPath from '../../src/Storage/EntryPath.js';

describe('entryPath', () => {
  it('puts one separator between the directory and the name', () => {
    expect(entryPath('/app/data', 'tokens.json')).toBe('/app/data/tokens.json');
  });

  it('adds no second separator after a directory that ends in one', () => {
    expect(entryPath('/app/data/', 'tokens.json')).toBe('/app/data/tokens.json');
  });

  it('keeps a ".." after a symlink for the OS to resolve', () => {
    expect(entryPath('/app/link/..', 'tokens.json')).toBe('/app/link/../tokens.json');
  });

  it('keeps "." and repeated separators as written', () => {
    expect(entryPath('/app//./data', 'tokens.json')).toBe('/app//./data/tokens.json');
  });
});
