import { describe, expect, it } from 'vitest';

import {
  ALLOW_ALL, fromCsv, fromEnv,
} from '../../../../src/Scrapers/Pipeline/Context/BankFilterPolicy.js';

describe('BankFilterPolicy', () => {
  describe('ALLOW_ALL', () => {
    it('admits every bank name', () => {
      expect(ALLOW_ALL.matches('hapoalim')).toBe(true);
      expect(ALLOW_ALL.matches('')).toBe(true);
      expect(ALLOW_ALL.matches('any-random-name')).toBe(true);
    });
  });

  describe('fromCsv', () => {
    it('returns ALLOW_ALL when csv is empty string', () => {
      expect(fromCsv('')).toBe(ALLOW_ALL);
    });

    it('returns ALLOW_ALL when csv contains only whitespace+commas', () => {
      expect(fromCsv(' , , ')).toBe(ALLOW_ALL);
    });

    it('admits only banks in the csv list', () => {
      const filter = fromCsv('hapoalim,leumi');
      expect(filter.matches('hapoalim')).toBe(true);
      expect(filter.matches('leumi')).toBe(true);
      expect(filter.matches('discount')).toBe(false);
    });

    it('trims whitespace around CSV tokens', () => {
      const filter = fromCsv(' hapoalim , leumi ');
      expect(filter.matches('hapoalim')).toBe(true);
      expect(filter.matches('leumi')).toBe(true);
    });

    it('is case-sensitive', () => {
      const filter = fromCsv('Hapoalim');
      expect(filter.matches('Hapoalim')).toBe(true);
      expect(filter.matches('hapoalim')).toBe(false);
    });
  });

  describe('fromEnv', () => {
    it('returns ALLOW_ALL when IMPORT_BANKS is unset', () => {
      expect(fromEnv({})).toBe(ALLOW_ALL);
    });

    it('returns ALLOW_ALL when IMPORT_BANKS is empty', () => {
      expect(fromEnv({ IMPORT_BANKS: '' })).toBe(ALLOW_ALL);
    });

    it('delegates to fromCsv with IMPORT_BANKS value', () => {
      const filter = fromEnv({ IMPORT_BANKS: 'hapoalim,leumi' });
      expect(filter.matches('hapoalim')).toBe(true);
      expect(filter.matches('discount')).toBe(false);
    });

    it('ignores unrelated env variables', () => {
      const filter = fromEnv({ OTHER_VAR: 'value' });
      expect(filter).toBe(ALLOW_ALL);
    });
  });
});
