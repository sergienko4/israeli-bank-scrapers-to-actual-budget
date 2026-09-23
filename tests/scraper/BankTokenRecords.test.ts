/**
 * Rules for turning stored records into bank tokens and back.
 *
 * <p>Pure: no filesystem. The store adapter decides what to do with what is
 * lost here; this file proves only what counts as a usable token and that a
 * loss is always counted, because an uncounted loss would be overwritten on
 * the next write without being quarantined first.
 */

import { describe, expect, it } from 'vitest';

import type { IBankTokenRecord } from '../../src/Scraper/Tokens/BankTokenRecords.js';
import {
  NO_TOKEN, readTokenRecords, toStoreRecords,
} from '../../src/Scraper/Tokens/BankTokenRecords.js';
import { fakeUuid } from '../helpers/factories.js';

/** Capture moment used where the exact value is asserted. */
const CAPTURED_AT = '2026-09-23T15:11:00.000Z';

/**
 * Builds a stored entry the way a previous write would have left it.
 * @param overrides - Fields to replace.
 * @returns A well-formed entry with a fresh token.
 */
function storedEntry(overrides: Partial<IBankTokenRecord> = {}): IBankTokenRecord {
  return { token: `lt-${fakeUuid()}`, capturedAt: CAPTURED_AT, ...overrides };
}

describe('BankTokenRecords', () => {
  describe('readTokenRecords', () => {
    it('reads an empty record set as no tokens, with nothing lost', () => {
      const read = readTokenRecords({});
      expect({ size: read.tokens.size, dropped: read.droppedCount }).toEqual({ size: 0, dropped: 0 });
    });

    it('keeps a well-formed entry together with its capture moment', () => {
      const entry = storedEntry();
      const read = readTokenRecords({ oneZero: entry });
      expect(read.tokens.get('oneZero')).toEqual(entry);
    });

    it('records an absent capture moment as an empty string', () => {
      const token = `lt-${fakeUuid()}`;
      const read = readTokenRecords({ oneZero: { token } });
      expect(read.tokens.get('oneZero')).toEqual({ token, capturedAt: '' });
    });

    it('records a capture moment that is not a string as an empty string', () => {
      const token = `lt-${fakeUuid()}`;
      const read = readTokenRecords({ oneZero: { token, capturedAt: 1_758_640_260_000 } });
      expect(read.tokens.get('oneZero')?.capturedAt).toBe('');
    });

    it('trims a token that was stored padded', () => {
      const token = `lt-${fakeUuid()}`;
      const read = readTokenRecords({ oneZero: storedEntry({ token: `  ${token}\n` }) });
      expect(read.tokens.get('oneZero')?.token).toBe(token);
    });

    it('does not count padding as a loss, since nothing was lost', () => {
      const read = readTokenRecords({ oneZero: storedEntry({ token: ' padded-token ' }) });
      expect(read.droppedCount).toBe(0);
    });

    it('drops a whitespace-only token rather than passing a blank on', () => {
      const read = readTokenRecords({ oneZero: storedEntry({ token: '   ' }) });
      expect(read.tokens.has('oneZero')).toBe(false);
    });

    it('counts a whitespace-only token as a loss', () => {
      const read = readTokenRecords({ oneZero: storedEntry({ token: ' \t ' }) });
      expect(read.droppedCount).toBe(1);
    });

    it('drops an entry whose token is not a string', () => {
      const read = readTokenRecords({ oneZero: { token: 42, capturedAt: CAPTURED_AT } });
      expect({ has: read.tokens.has('oneZero'), dropped: read.droppedCount })
        .toEqual({ has: false, dropped: 1 });
    });

    it('drops a null entry without discarding its siblings', () => {
      const sibling = storedEntry();
      const read = readTokenRecords({ pepper: null, oneZero: sibling });
      expect([...read.tokens.entries()]).toEqual([['oneZero', sibling]]);
    });

    it('counts every entry it drops, not just the first', () => {
      const read = readTokenRecords({
        pepper: null, payBox: 'not-an-entry', oneZero: storedEntry(),
      });
      expect(read.droppedCount).toBe(2);
    });

    it('never takes a token from a polluted prototype', () => {
      const prototype = Object.prototype as Record<string, unknown>;
      prototype.token = 'inherited-token';
      try {
        const read = readTokenRecords({ oneZero: { capturedAt: CAPTURED_AT } });
        expect(read.tokens.has('oneZero')).toBe(false);
      } finally {
        delete prototype.token;
      }
    });
  });

  describe('toStoreRecords', () => {
    it('writes each token as a flat record keyed by its store key', () => {
      const entry = storedEntry();
      const tokens = new Map([['oneZero:personal', entry]]);
      expect(toStoreRecords(tokens)).toEqual({ 'oneZero:personal': entry });
    });

    it('writes an empty set of tokens as an empty object', () => {
      expect(toStoreRecords(new Map())).toEqual({});
    });

    it('round-trips through readTokenRecords unchanged', () => {
      const tokens = new Map([['oneZero', storedEntry()], ['pepper', storedEntry()]]);
      const read = readTokenRecords(toStoreRecords(tokens));
      expect(read.tokens).toEqual(tokens);
    });

    it('keeps a __proto__ key as an entry, so the store can refuse it by name', () => {
      const records = toStoreRecords(new Map([['__proto__', storedEntry()]]));
      expect(Object.hasOwn(records, '__proto__')).toBe(true);
    });
  });

  it('uses the empty string for every "nothing stored" outcome', () => {
    expect(NO_TOKEN).toBe('');
  });
});
