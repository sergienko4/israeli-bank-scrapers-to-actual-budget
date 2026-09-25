/**
 * Write-path behaviour of {@link BankTokenStore}.
 *
 * <p>The write is where a mistake costs a credential: it replaces the whole
 * file, and the bank re-issues a lost token only by SMS. So every case here is
 * about what survives a write — the other accounts, damaged evidence, and a
 * store the adapter could not read — rather than about bytes on disk, which
 * `tests/storage` already proves.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IMoveOutcome } from '../../src/Storage/FileSystemPort.js';
import type { Procedure } from '../../src/Types/Procedure.js';
import { fail } from '../../src/Types/ProcedureHelpers.js';
import FakeFileSystem from '../storage/FakeFileSystem.js';
import { NO_LOGIN } from '../../src/Scraper/Tokens/BankTokenRecords.js';
import { fakeLoginFingerprint } from '../helpers/factories.js';
import {
  ACCOUNT_LOGIN, CAPTURED_AT, fakeToken, makeStore, OWNER_ONLY, quarantinedNames, seedRaw, seedRecords,
  STORE_PATH, storedRecords, WORLD_READABLE,
} from './BankTokenStoreFixture.js';

/** Moment the clock reads while a token is captured. */
const NOW = '2026-09-24T08:30:00.000Z';

/**
 * A filesystem that refuses only to move the store aside.
 *
 * <p>Failing every rename cannot tell a refused quarantine from a refused
 * publish, and a write that skipped the quarantine would fail the same way.
 * Refusing only the quarantine's destination leaves the publish free to
 * succeed, so the case fails if the adapter never asked for a quarantine.
 */
class NoQuarantineFileSystem extends FakeFileSystem {
  /**
   * Refuses a move onto a quarantine name and performs any other.
   * @param fromPath - Existing name to move.
   * @param toPath - Destination.
   * @returns A refusal for a quarantine, otherwise the fake's own outcome.
   */
  public override rename(fromPath: string, toPath: string): Procedure<IMoveOutcome> {
    if (toPath.startsWith(`${STORE_PATH}.quarantined-`)) {
      return fail(`Could not rename onto ${toPath}: EACCES`, { status: 'EACCES' });
    }
    return super.rename(fromPath, toPath);
  }
}

describe('BankTokenStore write', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('storing a token', () => {
    it('stores a token that a later read returns', () => {
      const { store } = makeStore();
      const token = fakeToken();
      store.write('oneZero', token, ACCOUNT_LOGIN);
      expect(store.read('oneZero')).toMatchObject({ success: true, data: { record: { token: token } } });
    });

    it('reports a first token as written', () => {
      const { store } = makeStore();
      expect(store.write('oneZero', fakeToken(), ACCOUNT_LOGIN)).toMatchObject({ success: true, data: { written: true } });
    });

    it('replaces the previous token for the same account', () => {
      const { store, fileSystem } = makeStore();
      seedRecords(fileSystem, { oneZero: { token: fakeToken(), capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });
      const fresh = fakeToken();
      store.write('oneZero', fresh, ACCOUNT_LOGIN);
      expect(store.read('oneZero')).toMatchObject({ success: true, data: { record: { token: fresh } } });
    });

    it('keeps every other account when one is updated', () => {
      const { store, fileSystem } = makeStore();
      const pepper = { token: fakeToken(), capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN };
      seedRecords(fileSystem, { pepper });
      store.write('oneZero', fakeToken(), ACCOUNT_LOGIN);
      expect(storedRecords(fileSystem).pepper).toEqual(pepper);
    });

    it('records when the token was captured, so an operator can judge its age', () => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date(NOW) });
      const { store, fileSystem } = makeStore();
      store.write('oneZero', fakeToken(), ACCOUNT_LOGIN);
      expect(storedRecords(fileSystem).oneZero).toMatchObject({ capturedAt: NOW });
    });

    it('binds the token to the login that minted it', () => {
      const { store, fileSystem } = makeStore();
      store.write('oneZero', fakeToken(), ACCOUNT_LOGIN);
      expect(storedRecords(fileSystem).oneZero).toMatchObject({ login: ACCOUNT_LOGIN });
    });

    it('replaces this account\'s record, login included, once its login changes', () => {
      const { store, fileSystem } = makeStore();
      seedRecords(fileSystem, { oneZero: { token: fakeToken(), capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });
      const [token, login] = [fakeToken(), fakeLoginFingerprint()];
      store.write('oneZero', token, login);
      expect(storedRecords(fileSystem).oneZero).toMatchObject({ token, login });
    });

    it('stores one token under a second key bound to the same login', () => {
      const { store, fileSystem } = makeStore();
      const token = fakeToken();
      seedRecords(fileSystem, { 'oneZero:a': { token, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });
      expect(store.write('oneZero:b', token, ACCOUNT_LOGIN)).toMatchObject({ success: true, data: { written: true } });
      expect(storedRecords(fileSystem)['oneZero:b']).toMatchObject({ token, login: ACCOUNT_LOGIN });
    });

    it('stores the token trimmed, as a read would return it', () => {
      const { store, fileSystem } = makeStore();
      const token = fakeToken();
      store.write('oneZero', `  ${token}\n`, ACCOUNT_LOGIN);
      expect(storedRecords(fileSystem).oneZero).toMatchObject({ token });
    });
  });

  describe('a token with nothing to store', () => {
    it('never persists an empty token, which is what a run minting none returns', () => {
      const { store, fileSystem } = makeStore();
      const result = store.write('oneZero', '', ACCOUNT_LOGIN);
      expect({ result, calls: fileSystem.calls })
        .toMatchObject({ result: { success: true, data: { written: false } }, calls: [] });
    });

    it('never persists a whitespace-only token', () => {
      const { store, fileSystem } = makeStore();
      store.write('oneZero', ' \n\t ', ACCOUNT_LOGIN);
      expect(fileSystem.hasEntry(STORE_PATH)).toBe(false);
    });

    it('reports no write when the stored token already matches', () => {
      const { store, fileSystem } = makeStore();
      const token = fakeToken();
      seedRecords(fileSystem, { oneZero: { token, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });
      expect(store.write('oneZero', token, ACCOUNT_LOGIN)).toMatchObject({ success: true, data: { written: false } });
    });

    it('still makes a world-readable store owner-only when the token is unchanged', () => {
      const { store, fileSystem } = makeStore();
      const token = fakeToken();
      seedRecords(fileSystem, { oneZero: { token, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } }, WORLD_READABLE);
      store.write('oneZero', token, ACCOUNT_LOGIN);
      expect(fileSystem.modeOf(STORE_PATH)).toBe(OWNER_ONLY);
    });

    it('does not count padding on a stored token as damage', () => {
      const { store, fileSystem } = makeStore();
      const token = fakeToken();
      seedRecords(fileSystem, { oneZero: { token: ` ${token} `, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });
      store.write('pepper', fakeToken(), ACCOUNT_LOGIN);
      expect(quarantinedNames(fileSystem)).toEqual([]);
    });

    it('never quarantines a well-formed store that holds no accounts yet', () => {
      const { store, fileSystem } = makeStore();
      seedRecords(fileSystem, {});
      store.write('oneZero', fakeToken(), ACCOUNT_LOGIN);
      expect(quarantinedNames(fileSystem)).toEqual([]);
    });
  });

  describe('a token the file binds to another login', () => {
    /**
     * Seeds a store binding one token to a login other than the writer's.
     * @param storeKey - Key the existing binding is stored under.
     * @returns The store, its filesystem, the bound token and the file as seeded.
     */
    function seedBoundElsewhere(storeKey: string): ReturnType<typeof makeStore> & { token: string; seeded: string } {
      const arranged = makeStore();
      const token = fakeToken();
      seedRecords(arranged.fileSystem, { [storeKey]: { token, capturedAt: CAPTURED_AT, login: fakeLoginFingerprint() } });
      return { ...arranged, token, seeded: arranged.fileSystem.contentsOf(STORE_PATH) };
    }

    it.each(['oneZero:other', 'oneZero'])('refuses to bind it again under %s, leaving the file as it was', (storeKey: string) => {
      const { store, fileSystem, token, seeded } = seedBoundElsewhere(storeKey);
      const result = store.write('oneZero', token, ACCOUNT_LOGIN);
      expect({ result, left: fileSystem.contentsOf(STORE_PATH) })
        .toMatchObject({ result: { success: false }, left: seeded });
    });

    it.each([
      ['a third login', fakeLoginFingerprint()],
      ['one of the two logins', ACCOUNT_LOGIN],
    ])('refuses a token the file binds to two logins, for %s, leaving the file as it was', (_label: string, login: string) => {
      const { store, fileSystem } = makeStore();
      const contested = fakeToken();
      seedRecords(fileSystem, {
        'pepper:a': { token: contested, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN },
        'pepper:b': { token: contested, capturedAt: CAPTURED_AT, login: fakeLoginFingerprint() },
      });
      const seeded = fileSystem.contentsOf(STORE_PATH);
      const result = store.write('oneZero', contested, login);
      expect({ result, left: fileSystem.contentsOf(STORE_PATH), kept: quarantinedNames(fileSystem) })
        .toMatchObject({ result: { success: false }, left: seeded, kept: [] });
    });

    it('names the account in the refusal, but never the token', () => {
      const { store, token } = seedBoundElsewhere('oneZero:other');
      const result = store.write('oneZero:personal', token, ACCOUNT_LOGIN);
      expect(!result.success && result.message)
        .toBe('Could not store the long-term token for oneZero:personal: the token file binds it to another login');
      expect(JSON.stringify(result)).not.toContain(token);
    });
  });

  describe('a login that is not a fingerprint', () => {
    it.each([
      ['no login', NO_LOGIN],
      ['a token passed in its place', 'lt-7d0c1f3a'],
      ['uppercase hex', 'A'.repeat(64)],
    ])('refuses %s without touching the filesystem', (_label: string, login: string) => {
      const { store, fileSystem } = makeStore();
      const result = store.write('oneZero', fakeToken(), login);
      expect({ result, calls: fileSystem.calls }).toMatchObject({
        result: { success: false, message: 'Could not store the long-term token for oneZero: there is no login to bind it to' },
        calls: [],
      });
    });
  });

  describe('a damaged store', () => {
    it('sets aside a store written before tokens were bound, then binds the token', () => {
      const { store, fileSystem } = makeStore();
      seedRecords(fileSystem, { pepper: { token: fakeToken(), capturedAt: CAPTURED_AT } });
      const token = fakeToken();
      store.write('oneZero', token, ACCOUNT_LOGIN);
      expect({ kept: quarantinedNames(fileSystem).length, stored: storedRecords(fileSystem) })
        .toEqual({ kept: 1, stored: { oneZero: { token, capturedAt: expect.any(String), login: ACCOUNT_LOGIN } } });
    });

    it('sets aside a store that binds one token to two logins', () => {
      const { store, fileSystem } = makeStore();
      const contested = fakeToken();
      seedRecords(fileSystem, {
        'pepper:a': { token: contested, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN },
        'pepper:b': { token: contested, capturedAt: CAPTURED_AT, login: fakeLoginFingerprint() },
      });
      store.write('oneZero', fakeToken(), ACCOUNT_LOGIN);
      expect({ kept: quarantinedNames(fileSystem).length, keys: Object.keys(storedRecords(fileSystem)) })
        .toEqual({ kept: 1, keys: ['oneZero'] });
    });

    it('sets an unparseable store aside instead of overwriting it', () => {
      const { store, fileSystem } = makeStore();
      const damaged = '{"oneZero": {"token": "trunc';
      seedRaw(fileSystem, damaged);
      store.write('oneZero', fakeToken(), ACCOUNT_LOGIN);
      const [quarantined] = quarantinedNames(fileSystem);
      expect(fileSystem.contentsOf(quarantined)).toBe(damaged);
    });

    it('stores the fresh token after setting the damage aside', () => {
      const { store, fileSystem } = makeStore();
      seedRaw(fileSystem, 'not json at all');
      const token = fakeToken();
      store.write('oneZero', token, ACCOUNT_LOGIN);
      expect(store.read('oneZero')).toMatchObject({ success: true, data: { record: { token: token } } });
    });

    it('sets aside a store whose root is an array, then stores the token', () => {
      const { store, fileSystem } = makeStore();
      seedRaw(fileSystem, '[]');
      const token = fakeToken();
      store.write('oneZero', token, ACCOUNT_LOGIN);
      expect({ kept: quarantinedNames(fileSystem).length, stored: storedRecords(fileSystem).oneZero })
        .toMatchObject({ kept: 1, stored: { token } });
    });

    it('sets aside a store holding an entry whose token is not a string', () => {
      const { store, fileSystem } = makeStore();
      seedRecords(fileSystem, { pepper: { token: 42, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });
      store.write('oneZero', fakeToken(), ACCOUNT_LOGIN);
      expect(quarantinedNames(fileSystem)).toHaveLength(1);
    });

    it('sets aside a store holding a whitespace-only token', () => {
      const { store, fileSystem } = makeStore();
      seedRecords(fileSystem, { pepper: { token: '   ', capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });
      store.write('oneZero', fakeToken(), ACCOUNT_LOGIN);
      expect(quarantinedNames(fileSystem)).toHaveLength(1);
    });

    it('keeps a healthy account stored beside a null entry', () => {
      const { store, fileSystem } = makeStore();
      const pepper = { token: fakeToken(), capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN };
      seedRecords(fileSystem, { payBox: null, pepper });
      store.write('oneZero', fakeToken(), ACCOUNT_LOGIN);
      expect(storedRecords(fileSystem).pepper).toEqual(pepper);
    });

    it('fails the write when a directory occupies the store path', () => {
      const { store, fileSystem } = makeStore();
      fileSystem.seedDirectory(STORE_PATH);
      expect(store.write('oneZero', fakeToken(), ACCOUNT_LOGIN)).toMatchObject({ success: false });
    });

    it('fails the write, leaving the damage in place, when it cannot be set aside', () => {
      const { store, fileSystem } = makeStore(new NoQuarantineFileSystem());
      const damaged = 'not json at all';
      seedRaw(fileSystem, damaged);
      const result = store.write('oneZero', fakeToken(), ACCOUNT_LOGIN);
      expect({ result, left: fileSystem.contentsOf(STORE_PATH) })
        .toMatchObject({ result: { success: false, status: 'EACCES' }, left: damaged });
    });

    it('sets a symlink at the store path aside as evidence, then stores the token', () => {
      const { store, fileSystem } = makeStore();
      fileSystem.seedFile('/home/victim/settings.json', '{"unrelated":true}', WORLD_READABLE);
      fileSystem.seedSymlink(STORE_PATH, '/home/victim/settings.json');
      const token = fakeToken();
      store.write('oneZero', token, ACCOUNT_LOGIN);
      expect({ kept: quarantinedNames(fileSystem).length, read: store.read('oneZero') })
        .toMatchObject({ kept: 1, read: { success: true, data: { record: { token } } } });
    });
  });

  describe('an identical token on a damaged store', () => {
    /**
     * Seeds a store holding this account's token beside an unusable entry.
     * @returns The store, its filesystem and the token already stored.
     */
    function seedDamagedAround(): ReturnType<typeof makeStore> & { token: string } {
      const arranged = makeStore();
      const token = fakeToken();
      seedRecords(arranged.fileSystem, { pepper: null, oneZero: { token, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });
      return { ...arranged, token };
    }

    it('still sets the damage aside, though this account has nothing new', () => {
      const { store, fileSystem, token } = seedDamagedAround();
      store.write('oneZero', token, ACCOUNT_LOGIN);
      expect(quarantinedNames(fileSystem)).toHaveLength(1);
    });

    it('leaves a clean store behind, so the next run finds no damage', () => {
      const { store, fileSystem, token } = seedDamagedAround();
      store.write('oneZero', token, ACCOUNT_LOGIN);
      expect(Object.keys(storedRecords(fileSystem))).toEqual(['oneZero']);
    });

    it('reports a write, because the file on disk was replaced', () => {
      const { store, token } = seedDamagedAround();
      expect(store.write('oneZero', token, ACCOUNT_LOGIN)).toMatchObject({ success: true, data: { written: true } });
    });
  });

  describe('a store it could not read', () => {
    it('never replaces a store it could not close after reading', () => {
      const { store, fileSystem } = makeStore();
      seedRecords(fileSystem, { pepper: { token: fakeToken(), capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });
      fileSystem.forcedFailures.set('close', 'EIO');
      const result = store.write('oneZero', fakeToken(), ACCOUNT_LOGIN);
      expect({ result, staged: fileSystem.stagedPaths })
        .toMatchObject({ result: { success: false, status: 'EIO' }, staged: [] });
    });

    it('never replaces a store it is not allowed to open', () => {
      const { store, fileSystem } = makeStore();
      seedRecords(fileSystem, { pepper: { token: fakeToken(), capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });
      fileSystem.forcedFailures.set('openForRead', 'EACCES');
      store.write('oneZero', fakeToken(), ACCOUNT_LOGIN);
      expect(fileSystem.stagedPaths).toEqual([]);
    });

    it('leaves a hard-linked store and its other name untouched', () => {
      const { store, fileSystem } = makeStore();
      seedRecords(fileSystem, { pepper: { token: fakeToken(), capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } }, WORLD_READABLE);
      fileSystem.seedHardLink(STORE_PATH, '/home/victim/notes.json');
      const before = fileSystem.contentsOf('/home/victim/notes.json');
      const result = store.write('oneZero', fakeToken(), ACCOUNT_LOGIN);
      expect({ result, contents: fileSystem.contentsOf('/home/victim/notes.json'), mode: fileSystem.modeOf('/home/victim/notes.json') })
        .toMatchObject({ result: { success: false }, contents: before, mode: WORLD_READABLE });
    });
  });

  describe('a commit that fails', () => {
    it('reports a failure instead of throwing when the file cannot be created', () => {
      const { store, fileSystem } = makeStore();
      fileSystem.forcedFailures.set('createExclusive', 'EACCES');
      expect(store.write('oneZero', fakeToken(), ACCOUNT_LOGIN)).toMatchObject({ success: false, status: 'EACCES' });
    });

    it('names the account whose token was lost, so the warning is actionable', () => {
      const { store, fileSystem } = makeStore();
      fileSystem.forcedFailures.set('rename', 'EXDEV');
      const result = store.write('oneZero:personal', fakeToken(), ACCOUNT_LOGIN);
      expect(!result.success && result.message).toContain('oneZero:personal');
    });

    it('never repeats the token in a failure message', () => {
      const { store, fileSystem } = makeStore();
      fileSystem.forcedFailures.set('rename', 'EXDEV');
      const token = fakeToken();
      const result = store.write('oneZero', token, ACCOUNT_LOGIN);
      expect(JSON.stringify(result)).not.toContain(token);
    });

    it('keeps the store\'s recovery hint when a staged credential is left behind', () => {
      const { store, fileSystem } = makeStore();
      fileSystem.forcedFailures.set('rename', 'EXDEV');
      fileSystem.forcedFailures.set('remove', 'EPERM');
      const result = store.write('oneZero', fakeToken(), ACCOUNT_LOGIN);
      const [staged] = fileSystem.stagedPaths;
      expect(!result.success && result.details).toEqual([`Staged file remains at ${staged}`]);
    });

    it('never lets a polluted prototype rewrite the tokens it stores', () => {
      const { store, fileSystem } = makeStore();
      const pepper = { token: fakeToken(), capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN };
      seedRecords(fileSystem, { pepper });
      const prototype = Object.prototype as Record<string, unknown>;
      prototype.toJSON = (): unknown => ({ token: 'attacker-token', capturedAt: '' });
      try {
        store.write('oneZero', fakeToken(), ACCOUNT_LOGIN);
      } finally {
        delete prototype.toJSON;
      }
      expect(storedRecords(fileSystem).pepper).toEqual(pepper);
    });

    it('refuses a store key that a read would strip, rather than reporting it stored', () => {
      const { store, fileSystem } = makeStore();
      const result = store.write('__proto__', fakeToken(), ACCOUNT_LOGIN);
      expect({ result, staged: fileSystem.stagedPaths }).toMatchObject({
        result: { success: false, status: 'EINVAL', message: expect.stringContaining('cannot include __proto__') },
        staged: [],
      });
    });
  });

  describe('the store key is opaque', () => {
    it('keeps two accounts of one bank apart', () => {
      const { store } = makeStore();
      const personal = fakeToken();
      store.write('oneZero:personal', personal, ACCOUNT_LOGIN);
      store.write('oneZero:business', fakeToken(), ACCOUNT_LOGIN);
      expect(store.read('oneZero:personal')).toMatchObject({ success: true, data: { record: { token: personal } } });
    });

    it('stores each key verbatim, so the file can be matched to a config entry', () => {
      const { store, fileSystem } = makeStore();
      store.write('oneZero:Personal Account', fakeToken(), ACCOUNT_LOGIN);
      expect(Object.keys(storedRecords(fileSystem))).toEqual(['oneZero:Personal Account']);
    });
  });
});
