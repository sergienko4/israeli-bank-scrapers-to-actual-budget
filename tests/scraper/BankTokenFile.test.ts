import { describe, expect, it } from 'vitest';

import {
  damagedRead, NO_TOKEN, readBankMap, toFile,
} from '../../src/Scraper/Tokens/BankTokenFile.js';

describe('BankTokenFile', () => {
  describe('readBankMap rejects anything it cannot fully understand', () => {
    it('reports a non-object payload as damage', () => {
      expect(readBankMap('just a string').isIntact).toBe(false);
    });

    it('reports null as damage', () => {
      expect(readBankMap(null).isIntact).toBe(false);
    });

    it('reports a payload with no banks key as damage', () => {
      expect(readBankMap({ tokens: {} }).isIntact).toBe(false);
    });

    it('reports a null banks key as damage', () => {
      expect(readBankMap({ banks: null }).isIntact).toBe(false);
    });

    it('reports an array banks key as damage, not as an empty store', () => {
      expect(readBankMap({ banks: [] }).isIntact).toBe(false);
    });

    it('accepts a well-formed store holding no banks yet', () => {
      const read = readBankMap({ banks: {} });
      expect(read.isIntact).toBe(true);
      expect(read.records.size).toBe(0);
    });
  });

  describe('readBankMap reading entries', () => {
    it('keeps a well-formed entry with its capture moment', () => {
      const parsed = { banks: { oneZero: { token: 'id-token', capturedAt: '2026-01-01T00:00:00.000Z' } } };
      const record = readBankMap(parsed).records.get('oneZero');
      expect(record).toEqual({ token: 'id-token', capturedAt: '2026-01-01T00:00:00.000Z' });
    });

    it('records an absent capture moment as an empty string', () => {
      const read = readBankMap({ banks: { oneZero: { token: 'id-token' } } });
      expect(read.records.get('oneZero')?.capturedAt).toBe('');
    });

    it('trims a token that was stored padded', () => {
      const read = readBankMap({ banks: { oneZero: { token: '  id-token  ' } } });
      expect(read.records.get('oneZero')?.token).toBe('id-token');
    });

    it('treats padding alone as no damage, since nothing was lost', () => {
      expect(readBankMap({ banks: { oneZero: { token: '  id-token  ' } } }).isIntact).toBe(true);
    });

    it('drops a whitespace-only token rather than passing a blank on', () => {
      const read = readBankMap({ banks: { oneZero: { token: '   ' } } });
      expect(read.records.has('oneZero')).toBe(false);
    });

    it('reports a whitespace-only token as damage', () => {
      expect(readBankMap({ banks: { oneZero: { token: '   ' } } }).isIntact).toBe(false);
    });

    it('drops an entry whose token is not a string', () => {
      const read = readBankMap({ banks: { oneZero: { token: 42 } } });
      expect(read.records.has('oneZero')).toBe(false);
    });

    it('drops a null entry without discarding its siblings', () => {
      const parsed = { banks: { oneZero: null, pepper: { token: 'pepper-token' } } };
      const read = readBankMap(parsed);
      expect(read.records.get('pepper')?.token).toBe('pepper-token');
    });

    it('reports a store that lost one entry as damaged', () => {
      const parsed = { banks: { oneZero: null, pepper: { token: 'pepper-token' } } };
      expect(readBankMap(parsed).isIntact).toBe(false);
    });
  });

  describe('damagedRead', () => {
    it('returns an empty, non-intact read', () => {
      const read = damagedRead();
      expect(read.records.size).toBe(0);
      expect(read.isIntact).toBe(false);
    });

    it('returns a fresh map each call, so one caller cannot see another edit', () => {
      const first = damagedRead();
      first.records.set('oneZero', { token: 'id-token', capturedAt: '' });
      expect(damagedRead().records.size).toBe(0);
    });
  });

  describe('toFile', () => {
    it('writes every record under the banks key', () => {
      const records = new Map([['oneZero', { token: 'id-token', capturedAt: '' }]]);
      expect(toFile(records)).toEqual({ banks: { oneZero: { token: 'id-token', capturedAt: '' } } });
    });

    it('round-trips through readBankMap unchanged', () => {
      const records = new Map([['oneZero', { token: 'id-token', capturedAt: '2026-01-01T00:00:00.000Z' }]]);
      const read = readBankMap(toFile(records));
      expect(read.records).toEqual(records);
    });

    it('serialises an empty set of records as an empty banks object', () => {
      expect(toFile(new Map())).toEqual({ banks: {} });
    });
  });

  describe('NO_TOKEN', () => {
    it('is the empty string every "nothing stored" path returns', () => {
      expect(NO_TOKEN).toBe('');
    });
  });
});
