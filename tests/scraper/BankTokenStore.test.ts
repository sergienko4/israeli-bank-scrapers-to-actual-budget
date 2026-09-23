import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync,
  rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BankTokenStore from '../../src/Scraper/Tokens/BankTokenStore.js';

let dir = '';
let storePath = '';

/**
 * Builds a store rooted in this test's own temp directory.
 * @returns A store isolated from every other test.
 */
function makeStore(): BankTokenStore {
  return new BankTokenStore(storePath);
}

/**
 * Lists every staging artifact left in the store directory.
 *
 * <p>Production names temp files `<store>.<uuid>.tmp`, so a fixed
 * `<store>.tmp` assertion is vacuously true and would still pass if cleanup
 * were deleted outright.
 * @returns Names of the temp files still present.
 */
function tempFilesInStoreDir(): string[] {
  const entries = readdirSync(dir);
  return entries.filter(name => name.endsWith('.tmp'));
}

/**
 * Lists the quarantine copies kept beside the store.
 * @returns Names of the `.corrupt` files present.
 */
function quarantineFilesInStoreDir(): string[] {
  const entries = readdirSync(dir);
  return entries.filter(name => name.endsWith('.corrupt'));
}

describe('BankTokenStore', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bank-tokens-'));
    storePath = join(dir, 'bank-tokens.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('read', () => {
    it('returns an empty token when the store file has never been written', () => {
      expect(makeStore().read('oneZero')).toBe('');
    });

    it('returns an empty token for a bank that has no stored entry', () => {
      const store = makeStore();
      store.write('oneZero', 'onezero-id-token');
      expect(store.read('pepper')).toBe('');
    });

    it('returns an empty token when the store file is not valid JSON', () => {
      writeFileSync(storePath, '{ this is not json');
      expect(makeStore().read('oneZero')).toBe('');
    });

    it('returns an empty token when the stored entry is not shaped as a record', () => {
      writeFileSync(storePath, JSON.stringify({ banks: { oneZero: 42 } }));
      expect(makeStore().read('oneZero')).toBe('');
    });

    it('still reads healthy banks when another bank entry is null', () => {
      writeFileSync(storePath, JSON.stringify({
        banks: {
          oneZero: { token: 'onezero-token', capturedAt: '2026-01-01T00:00:00.000Z' },
          payBox: null,
          pepper: { token: 'pepper-token', capturedAt: '2026-01-01T00:00:00.000Z' },
        },
      }));
      const store = makeStore();
      expect(store.read('oneZero')).toBe('onezero-token');
      expect(store.read('pepper')).toBe('pepper-token');
      expect(store.read('payBox')).toBe('');
    });

    it('reads a well-formed entry that is missing its capturedAt stamp', () => {
      writeFileSync(storePath, JSON.stringify({ banks: { oneZero: { token: 'bare-token' } } }));
      expect(makeStore().read('oneZero')).toBe('bare-token');
    });
  });

  describe('write', () => {
    it('round-trips a token through a fresh store', () => {
      const store = makeStore();
      const result = store.write('oneZero', 'onezero-id-token');
      expect(result.success).toBe(true);
      expect(store.read('oneZero')).toBe('onezero-id-token');
    });

    it('replaces a previous token for the same bank', () => {
      const store = makeStore();
      store.write('oneZero', 'first-token');
      store.write('oneZero', 'second-token');
      expect(store.read('oneZero')).toBe('second-token');
    });

    it('does not destroy healthy banks when writing alongside a null entry', () => {
      writeFileSync(storePath, JSON.stringify({
        banks: {
          oneZero: { token: 'onezero-token', capturedAt: '2026-01-01T00:00:00.000Z' },
          payBox: null,
        },
      }));
      const store = makeStore();
      expect(store.write('pepper', 'pepper-token').success).toBe(true);
      expect(store.read('oneZero')).toBe('onezero-token');
      expect(store.read('pepper')).toBe('pepper-token');
    });

    it('quarantines an unparseable store instead of silently deleting it', () => {
      writeFileSync(storePath, '{ this is not json');
      expect(makeStore().write('oneZero', 'onezero-token').success).toBe(true);
      const quarantined = quarantineFilesInStoreDir();
      expect(quarantined).toHaveLength(1);
      expect(readFileSync(join(dir, quarantined[0]), 'utf8')).toBe('{ this is not json');
    });

    it('preserves other banks when one bank is updated', () => {
      const store = makeStore();
      store.write('oneZero', 'onezero-token');
      store.write('payBox', 'paybox-token');
      store.write('oneZero', 'onezero-token-2');
      expect(store.read('payBox')).toBe('paybox-token');
      expect(store.read('oneZero')).toBe('onezero-token-2');
    });

    it('records when the token was captured so operators can judge its age', () => {
      makeStore().write('oneZero', 'onezero-id-token');
      const parsed = JSON.parse(readFileSync(storePath, 'utf8')) as {
        banks: Record<string, { capturedAt: string }>;
      };
      expect(Date.parse(parsed.banks.oneZero.capturedAt)).not.toBeNaN();
    });

    it('never persists an empty token, because upstream returns one when none exists', () => {
      const result = makeStore().write('oneZero', '');
      expect(result.success).toBe(true);
      expect(existsSync(storePath)).toBe(false);
    });

    it('never persists a whitespace-only token', () => {
      makeStore().write('oneZero', '   ');
      expect(existsSync(storePath)).toBe(false);
    });

    it('creates the store file owner-readable only, since the token bypasses 2FA', () => {
      makeStore().write('oneZero', 'onezero-id-token');
      expect(statSync(storePath).mode % 0o1000).toBe(0o600);
    });

    it('re-tightens permissions when it overwrites a world-readable store file', () => {
      writeFileSync(storePath, JSON.stringify({ banks: {} }));
      chmodSync(storePath, 0o666);
      makeStore().write('oneZero', 'onezero-id-token');
      expect(statSync(storePath).mode % 0o1000).toBe(0o600);
    });

    it('creates a missing parent directory owner-only', () => {
      const nested = join(dir, 'state');
      new BankTokenStore(join(nested, 'bank-tokens.json')).write('oneZero', 'tok');
      expect(statSync(nested).mode % 0o1000).toBe(0o700);
    });

    it('leaves no temp file behind after a successful write', () => {
      makeStore().write('oneZero', 'onezero-id-token');
      expect(tempFilesInStoreDir()).toEqual([]);
    });

    it('refuses the write when a directory occupies the store path', () => {
      mkdirSync(storePath);
      writeFileSync(join(storePath, 'occupant'), 'not a store this can move');
      const result = makeStore().write('oneZero', 'onezero-id-token');
      expect(result.success).toBe(false);
    });

    it('stages nothing when it refuses a store path it cannot quarantine', () => {
      mkdirSync(storePath);
      makeStore().write('oneZero', 'onezero-id-token');
      expect(tempFilesInStoreDir()).toEqual([]);
    });

    it('reports a typed failure instead of throwing when the path is unwritable', () => {
      const blocker = join(dir, 'blocker');
      writeFileSync(blocker, 'not a directory');
      const store = new BankTokenStore(join(blocker, 'bank-tokens.json'));
      const result = store.write('oneZero', 'onezero-id-token');
      expect(result.success).toBe(false);
    });

    it('creates a missing parent directory so a bare-metal run still warms', () => {
      const nested = join(dir, 'state', 'bank-tokens.json');
      const store = new BankTokenStore(nested);
      expect(store.write('oneZero', 'onezero-id-token').success).toBe(true);
      expect(store.read('oneZero')).toBe('onezero-id-token');
    });

    it('re-tightens a world-readable store even when the token is unchanged', () => {
      makeStore().write('oneZero', 'onezero-id-token');
      chmodSync(storePath, 0o666);
      makeStore().write('oneZero', 'onezero-id-token');
      expect(statSync(storePath).mode % 0o1000).toBe(0o600);
    });

    it('reports no write when the stored token already matches', () => {
      makeStore().write('oneZero', 'onezero-id-token');
      const result = makeStore().write('oneZero', 'onezero-id-token');
      expect(result.success && result.data.written).toBe(false);
    });
  });

  describe('an unchanged token does not excuse a damaged store', () => {
    const damaged = JSON.stringify({
      banks: { oneZero: { token: 'onezero-id-token' }, pepper: null },
    });

    it('quarantines the damage even when this bank has nothing new to store', () => {
      writeFileSync(storePath, damaged);
      makeStore().write('oneZero', 'onezero-id-token');
      expect(quarantineFilesInStoreDir()).toHaveLength(1);
    });

    it('rewrites the store, keeping the entries it could still understand', () => {
      writeFileSync(storePath, damaged);
      const store = makeStore();
      store.write('oneZero', 'onezero-id-token');
      expect(store.read('oneZero')).toBe('onezero-id-token');
    });

    it('leaves a clean store behind, so the next run finds no damage', () => {
      writeFileSync(storePath, damaged);
      makeStore().write('oneZero', 'onezero-id-token');
      makeStore().write('oneZero', 'onezero-id-token');
      expect(quarantineFilesInStoreDir()).toHaveLength(1);
    });

    it('reports a write, because the file on disk was replaced', () => {
      writeFileSync(storePath, damaged);
      const result = makeStore().write('oneZero', 'onezero-id-token');
      expect(result.success && result.data.written).toBe(true);
    });
  });

  describe('repeated quarantine', () => {
    /**
     * Freezes the clock so both quarantines fall in the same millisecond.
     *
     * <p>Real damage rarely recurs that fast, so leaving the timing to chance
     * makes the test pass or fail depending on how quick the machine is. The
     * collision this guards against is a property of the name, not the speed.
     * @returns Nothing; the caller restores the clock.
     */
    function freezeClock(): void {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-23T08:00:00.000Z'));
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it('keeps every salvage copy when damage recurs within the same moment', () => {
      freezeClock();
      writeFileSync(storePath, 'first damage holding a live credential');
      makeStore().write('oneZero', 'onezero-id-token');
      writeFileSync(storePath, 'second damage holding another credential');
      makeStore().write('oneZero', 'onezero-id-token');
      expect(quarantineFilesInStoreDir()).toHaveLength(2);
    });

    it('does not let a later salvage overwrite the contents of an earlier one', () => {
      freezeClock();
      writeFileSync(storePath, 'first damage holding a live credential');
      makeStore().write('oneZero', 'onezero-id-token');
      writeFileSync(storePath, 'second damage holding another credential');
      makeStore().write('oneZero', 'onezero-id-token');
      const saved = quarantineFilesInStoreDir().map(n => readFileSync(join(dir, n), 'utf8'));
      expect(saved).toContain('first damage holding a live credential');
    });
  });

  describe('write quarantine hardening', () => {
    it('hardens the quarantine copy, which carries the same standing credential', () => {
      writeFileSync(storePath, 'not json at all');
      chmodSync(storePath, 0o666);
      makeStore().write('oneZero', 'onezero-id-token');
      const [backup] = quarantineFilesInStoreDir();
      expect(statSync(join(dir, backup ?? '')).mode % 0o1000).toBe(0o600);
    });
  });

  describe('write structural damage', () => {
    it('quarantines a store whose top-level banks key is missing', () => {
      writeFileSync(storePath, JSON.stringify({}));
      makeStore().write('oneZero', 'onezero-id-token');
      expect(quarantineFilesInStoreDir()).toHaveLength(1);
    });

    it('quarantines a store whose banks key is not an object', () => {
      writeFileSync(storePath, JSON.stringify({ banks: null }));
      makeStore().write('oneZero', 'onezero-id-token');
      expect(quarantineFilesInStoreDir()).toHaveLength(1);
    });

    it('quarantines a store holding an entry whose token field is unreadable', () => {
      writeFileSync(storePath, JSON.stringify({ banks: { pepper: { tokn: 'typo' } } }));
      makeStore().write('oneZero', 'onezero-id-token');
      expect(quarantineFilesInStoreDir()).toHaveLength(1);
    });

    it('still stores the fresh token after quarantining a damaged store', () => {
      writeFileSync(storePath, JSON.stringify({ banks: null }));
      const store = makeStore();
      store.write('oneZero', 'onezero-id-token');
      expect(store.read('oneZero')).toBe('onezero-id-token');
    });

    it('never quarantines a well-formed store that simply holds no banks yet', () => {
      writeFileSync(storePath, JSON.stringify({ banks: {} }));
      makeStore().write('oneZero', 'onezero-id-token');
      expect(quarantineFilesInStoreDir()).toEqual([]);
    });
  });

  describe('read token normalisation', () => {
    it('treats a whitespace-only stored token as no token at all', () => {
      writeFileSync(storePath, JSON.stringify({ banks: { oneZero: { token: '   ' } } }));
      expect(makeStore().read('oneZero')).toBe('');
    });

    it('strips padding so a hand-edited entry still yields a usable token', () => {
      writeFileSync(storePath, JSON.stringify({ banks: { oneZero: { token: ' tok ' } } }));
      expect(makeStore().read('oneZero')).toBe('tok');
    });

    it('quarantines a store holding a whitespace-only token, which is damage', () => {
      writeFileSync(storePath, JSON.stringify({ banks: { pepper: { token: '   ' } } }));
      makeStore().write('oneZero', 'onezero-id-token');
      expect(quarantineFilesInStoreDir()).toHaveLength(1);
    });

    it('does not quarantine merely because a token was stored padded', () => {
      writeFileSync(storePath, JSON.stringify({ banks: { pepper: { token: ' tok ' } } }));
      makeStore().write('oneZero', 'onezero-id-token');
      expect(quarantineFilesInStoreDir()).toEqual([]);
    });
  });

  describe('read hardening', () => {
    it('re-tightens a world-readable store that a warm run only reads', () => {
      makeStore().write('oneZero', 'onezero-id-token');
      chmodSync(storePath, 0o666);
      makeStore().read('oneZero');
      expect(statSync(storePath).mode % 0o1000).toBe(0o600);
    });

    it('still returns the token it hardened', () => {
      makeStore().write('oneZero', 'onezero-id-token');
      chmodSync(storePath, 0o666);
      expect(makeStore().read('oneZero')).toBe('onezero-id-token');
    });

    it('does not create a store file just because one was read', () => {
      makeStore().read('oneZero');
      expect(existsSync(storePath)).toBe(false);
    });
  });

  describe('write refuses to destroy what it cannot quarantine', () => {
    it('fails the write when a damaged store cannot be set aside', () => {
      mkdirSync(storePath);
      writeFileSync(join(storePath, 'occupant'), 'blocks the rename');
      const result = makeStore().write('oneZero', 'onezero-id-token');
      const reason = result.success ? '' : result.message;
      expect(reason).toContain('could not be set aside');
    });

    it('leaves the damaged store in place when it refuses the write', () => {
      mkdirSync(storePath);
      writeFileSync(join(storePath, 'occupant'), 'blocks the rename');
      makeStore().write('oneZero', 'onezero-id-token');
      expect(existsSync(join(storePath, 'occupant'))).toBe(true);
    });

    it('quarantines a store whose banks key is an array', () => {
      writeFileSync(storePath, JSON.stringify({ banks: [] }));
      makeStore().write('oneZero', 'onezero-id-token');
      expect(quarantineFilesInStoreDir()).toHaveLength(1);
    });

    it('still stores the fresh token after quarantining an array store', () => {
      writeFileSync(storePath, JSON.stringify({ banks: [] }));
      const store = makeStore();
      store.write('oneZero', 'onezero-id-token');
      expect(store.read('oneZero')).toBe('onezero-id-token');
    });
  });

  describe('a symlink at the store path is never followed', () => {
    const victimContents = JSON.stringify({ banks: { oneZero: { token: 'someone-elses-token' } } });
    let victim = '';

    beforeEach(() => {
      victim = join(dir, 'victim.json');
      writeFileSync(victim, victimContents, { mode: 0o644 });
      symlinkSync(victim, storePath);
    });

    it('does not change the permissions of the file the link points at', () => {
      makeStore().read('oneZero');
      expect(statSync(victim).mode % 0o1000).toBe(0o644);
    });

    it('does not serve the linked file as a stored token', () => {
      expect(makeStore().read('oneZero')).toBe('');
    });

    it('moves the link aside rather than writing through it', () => {
      makeStore().write('oneZero', 'onezero-id-token');
      expect(quarantineFilesInStoreDir()).toHaveLength(1);
    });

    it('leaves the linked file untouched when it replaces the store', () => {
      makeStore().write('oneZero', 'onezero-id-token');
      expect(readFileSync(victim, 'utf8')).toBe(victimContents);
    });

    it('leaves a real file, not another link, in the store path', () => {
      makeStore().write('oneZero', 'onezero-id-token');
      expect(lstatSync(storePath).isSymbolicLink()).toBe(false);
    });

    it('stores the fresh token in the real file it wrote', () => {
      const store = makeStore();
      store.write('oneZero', 'onezero-id-token');
      expect(store.read('oneZero')).toBe('onezero-id-token');
    });
  });

  describe('a dangling symlink is evidence, not an absent store', () => {
    beforeEach(() => {
      symlinkSync(join(dir, 'nothing-here.json'), storePath);
    });

    it('quarantines the link instead of quietly replacing it', () => {
      makeStore().write('oneZero', 'onezero-id-token');
      expect(quarantineFilesInStoreDir()).toHaveLength(1);
    });

    it('keeps where the link pointed, which is the whole evidence', () => {
      makeStore().write('oneZero', 'onezero-id-token');
      const [quarantined] = quarantineFilesInStoreDir();
      expect(readlinkSync(join(dir, quarantined))).toBe(join(dir, 'nothing-here.json'));
    });

    it('still stores the fresh token in a real file', () => {
      const store = makeStore();
      store.write('oneZero', 'onezero-id-token');
      expect(store.read('oneZero')).toBe('onezero-id-token');
    });

    it('reports no token while the link is still in place', () => {
      expect(makeStore().read('oneZero')).toBe('');
    });
  });
  describe('the key is opaque to the store', () => {
    it('keeps two accounts of one bank apart', () => {
      const store = makeStore();
      store.write('oneZero:personal', 'personal-token');
      store.write('oneZero:business', 'business-token');
      expect(store.read('oneZero:personal')).toBe('personal-token');
    });

    it('does not let the second account overwrite the first', () => {
      const store = makeStore();
      store.write('oneZero:personal', 'personal-token');
      store.write('oneZero:business', 'business-token');
      expect(store.read('oneZero:business')).toBe('business-token');
    });

    it('treats a bare bank id as a different key from a composite one', () => {
      const store = makeStore();
      store.write('oneZero', 'bare-token');
      store.write('oneZero:personal', 'personal-token');
      expect(store.read('oneZero')).toBe('bare-token');
    });

    it('stores each key verbatim, so the file can be matched to a config entry', () => {
      makeStore().write('oneZero:personal', 'personal-token');
      expect(readFileSync(storePath, 'utf8')).toContain('"oneZero:personal"');
    });
  });
});
