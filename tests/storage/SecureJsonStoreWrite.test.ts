/**
 * Write-path behaviour of {@link SecureJsonStore}.
 *
 * <p>The ordering assertions here are the point of the file. Every one of them
 * encodes a failure that reached review in the previous attempt: staging after
 * quarantine, a staged credential surviving a failed commit, and a cleanup
 * error masking the error that actually mattered.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IMoveOutcome, IRemoveOutcome } from '../../src/Storage/FileSystemPort.js';
import SecureJsonStore from '../../src/Storage/SecureJsonStore.js';
import { MAX_STORE_BYTES } from '../../src/Storage/StoreRecords.js';
import type { Procedure } from '../../src/Types/Procedure.js';
import { fail } from '../../src/Types/ProcedureHelpers.js';
import FakeFileSystem from './FakeFileSystem.js';

/**
 * A filesystem that commits the quarantine but then fails the final move.
 *
 * <p>Isolates the one window the stage-first ordering cannot close, so the
 * damaged bytes are proven to survive it.
 */
class FailsAfterQuarantineFileSystem extends FakeFileSystem {
  private _renames = 0;

  /**
   * Renames once, then refuses.
   * @param fromPath - Existing name to move.
   * @param toPath - Destination name.
   * @returns The move outcome, or a failure from the second call onwards.
   */
  public override rename(fromPath: string, toPath: string): Procedure<IMoveOutcome> {
    this._renames += 1;
    if (this._renames > 1) return fail('forced commit failure', { status: 'EIO' });
    return super.rename(fromPath, toPath);
  }
}

/**
 * A filesystem whose cleanup throws rather than reporting failure.
 *
 * <p>Models the one case a `Procedure`-returning double cannot: an adapter
 * that raises. The commit must still report why it failed.
 */
class ThrowingRemoveFileSystem extends FakeFileSystem {
  /**
   * Fails loudly instead of reporting a removal outcome.
   * @returns Never; always throws.
   */
  public override remove(): Procedure<IRemoveOutcome> {
    throw new Error('remove exploded');
  }
}

/** Path every case commits to. */
const STORE_PATH = '/data/tokens.json';

/** Owner read/write only. */
const OWNER_ONLY = 0o600;

/** A credential value no error message may ever repeat. */
const SECRET = 'eyJhbGciOiJIUzI1NiJ9.super-secret-refresh-token';

/**
 * Builds a store over a fresh in-memory filesystem.
 * @returns The store under test and the filesystem behind it.
 */
function makeStore(): { store: SecureJsonStore; fileSystem: FakeFileSystem } {
  const fileSystem = new FakeFileSystem();
  return { store: new SecureJsonStore(fileSystem, STORE_PATH), fileSystem };
}

/**
 * Names present that are neither the store nor a quarantined copy.
 * @param fileSystem - Filesystem to inspect.
 * @returns Leftover names, which should always be empty.
 */
function leftovers(fileSystem: FakeFileSystem): string[] {
  return fileSystem.names().filter((name) => !name.startsWith(`${STORE_PATH}.quarantined`))
    .filter((name) => name !== STORE_PATH);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SecureJsonStore write path', () => {
  it('commits records that a later read returns unchanged', () => {
    const { store } = makeStore();
    const committed = store.commit({ records: { 'onezero:main': SECRET }, shouldQuarantine: false });
    expect(committed.success).toBe(true);
    const snapshot = store.read();
    expect(snapshot.success && snapshot.data.records['onezero:main']).toBe(SECRET);
  });

  it('commits the file owner-only, never at the process umask', () => {
    const { store, fileSystem } = makeStore();
    store.commit({ records: { a: 'b' }, shouldQuarantine: false });
    expect(fileSystem.modeOf(STORE_PATH)).toBe(OWNER_ONLY);
  });

  it('replaces an existing store atomically, leaving no staged file behind', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(STORE_PATH, '{"old":"v"}', OWNER_ONLY);
    store.commit({ records: { fresh: 'v' }, shouldQuarantine: false });
    expect(fileSystem.contentsOf(STORE_PATH)).toContain('fresh');
    expect(leftovers(fileSystem)).toHaveLength(0);
  });

  it('threat 2: stages under an unpredictable name, not a guessable suffix', () => {
    const { store, fileSystem } = makeStore();
    store.commit({ records: { a: '1' }, shouldQuarantine: false });
    store.commit({ records: { a: '2' }, shouldQuarantine: false });
    const [first, second] = fileSystem.stagedPaths;
    expect(first).not.toBe(second);
    expect(first).not.toBe(`${STORE_PATH}.tmp`);
  });

  it('threat 13: stages before quarantining, so a crash cannot strand the store', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(STORE_PATH, 'not json', OWNER_ONLY);
    store.commit({ records: { a: 'b' }, shouldQuarantine: true });
    const staged = fileSystem.calls.indexOf('createExclusive');
    const moved = fileSystem.calls.indexOf('rename');
    expect(staged).toBeGreaterThanOrEqual(0);
    expect(moved).toBeGreaterThanOrEqual(0);
    expect(staged).toBeLessThan(moved);
  });

  it('threat 13: leaves the store untouched when staging fails before any move', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(STORE_PATH, '{"old":"v"}', OWNER_ONLY);
    fileSystem.forcedFailures.set('createExclusive', 'ENOSPC');
    const committed = store.commit({ records: { fresh: 'v' }, shouldQuarantine: true });
    expect(committed.success).toBe(false);
    expect(fileSystem.contentsOf(STORE_PATH)).toBe('{"old":"v"}');
  });

  it('threat 13: never renames anything when staging fails', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(STORE_PATH, '{"old":"v"}', OWNER_ONLY);
    fileSystem.forcedFailures.set('createExclusive', 'ENOSPC');
    store.commit({ records: { fresh: 'v' }, shouldQuarantine: true });
    expect(fileSystem.calls).not.toContain('rename');
  });

  it('threat 12: two quarantines in the same millisecond do not collide', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(STORE_PATH, 'broken one', OWNER_ONLY);
    store.commit({ records: { a: '1' }, shouldQuarantine: true });
    fileSystem.seedFile(STORE_PATH, 'broken two', OWNER_ONLY);
    store.commit({ records: { a: '2' }, shouldQuarantine: true });
    const quarantined = fileSystem.names().filter((name) => name.includes('quarantined'));
    expect(quarantined).toHaveLength(2);
  });

  it('preserves the damaged bytes at the quarantine path for later inspection', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(STORE_PATH, 'corrupt-but-precious', OWNER_ONLY);
    store.commit({ records: { a: 'b' }, shouldQuarantine: true });
    const [quarantined] = fileSystem.names().filter((name) => name.includes('quarantined'));
    expect(fileSystem.contentsOf(quarantined ?? '')).toBe('corrupt-but-precious');
  });

  it('aborts rather than destroying the damaged file when quarantine fails', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(STORE_PATH, 'corrupt-but-precious', OWNER_ONLY);
    fileSystem.forcedFailures.set('rename', 'EACCES');
    const committed = store.commit({ records: { a: 'b' }, shouldQuarantine: true });
    expect(committed.success).toBe(false);
    expect(fileSystem.contentsOf(STORE_PATH)).toBe('corrupt-but-precious');
  });

  it('threat 14: removes the staged credential when quarantine fails', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(STORE_PATH, 'corrupt', OWNER_ONLY);
    fileSystem.forcedFailures.set('rename', 'EACCES');
    store.commit({ records: { token: SECRET }, shouldQuarantine: true });
    expect(leftovers(fileSystem)).toHaveLength(0);
  });

  it('threat 14: removes the staged credential when the final commit fails', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.forcedFailures.set('rename', 'EXDEV');
    store.commit({ records: { token: SECRET }, shouldQuarantine: false });
    expect(leftovers(fileSystem)).toHaveLength(0);
  });

  it('threat 14: reports the commit failure, not the outcome of the cleanup', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.forcedFailures.set('rename', 'EXDEV');
    const committed = store.commit({ records: { token: SECRET }, shouldQuarantine: false });
    expect(committed.success ? '' : committed.status).toBe('EXDEV');
  });

  it('threat 14: still reports the commit failure when cleanup itself fails', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.forcedFailures.set('rename', 'EXDEV');
    fileSystem.forcedFailures.set('remove', 'EPERM');
    const committed = store.commit({ records: { token: SECRET }, shouldQuarantine: false });
    expect(committed.success ? '' : committed.status).toBe('EXDEV');
  });

  it('threat 14: reports the commit failure even when cleanup throws', () => {
    const fileSystem = new ThrowingRemoveFileSystem();
    const store = new SecureJsonStore(fileSystem, STORE_PATH);
    fileSystem.forcedFailures.set('rename', 'EXDEV');
    const committed = store.commit({ records: { token: SECRET }, shouldQuarantine: false });
    expect(committed.success ? '' : committed.status).toBe('EXDEV');
  });

  it('threat 14: notes the staged file when cleanup throws, rather than going quiet', () => {
    const fileSystem = new ThrowingRemoveFileSystem();
    const store = new SecureJsonStore(fileSystem, STORE_PATH);
    fileSystem.forcedFailures.set('rename', 'EXDEV');
    const committed = store.commit({ records: { token: SECRET }, shouldQuarantine: false });
    expect(committed.success ? [] : committed.details ?? []).toHaveLength(1);
  });

  it('threat 13: keeps the damaged bytes in quarantine when the commit then fails', () => {
    const fileSystem = new FailsAfterQuarantineFileSystem();
    const store = new SecureJsonStore(fileSystem, STORE_PATH);
    fileSystem.seedFile(STORE_PATH, 'corrupt-but-precious', OWNER_ONLY);
    const committed = store.commit({ records: { token: SECRET }, shouldQuarantine: true });
    expect(committed.success).toBe(false);
    const [quarantined] = fileSystem.names().filter((name) => name.includes('quarantined'));
    expect(fileSystem.contentsOf(quarantined ?? '')).toBe('corrupt-but-precious');
  });

  it('threat 14: leaves no staged credential when the commit fails after quarantine', () => {
    const fileSystem = new FailsAfterQuarantineFileSystem();
    const store = new SecureJsonStore(fileSystem, STORE_PATH);
    fileSystem.seedFile(STORE_PATH, 'corrupt', OWNER_ONLY);
    store.commit({ records: { token: SECRET }, shouldQuarantine: true });
    expect(leftovers(fileSystem)).toHaveLength(0);
  });

  it('threat 11: never repeats the token in a commit failure message', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.forcedFailures.set('rename', 'EXDEV');
    const committed = store.commit({ records: { token: SECRET }, shouldQuarantine: false });
    if (committed.success) throw new Error('expected the forced rename failure to stop the commit');
    expect(committed.message).not.toContain(SECRET);
  });

  it('refuses a record JSON would drop, rather than reporting it as committed', () => {
    const { store, fileSystem } = makeStore();
    const committed = store.commit({
      records: { kept: 'value', dropped: undefined },
      shouldQuarantine: false,
    });
    expect(committed.success).toBe(false);
    expect(fileSystem.hasEntry(STORE_PATH)).toBe(false);
  });

  it('names the unwritable key so the caller can find it, without its value', () => {
    const { store } = makeStore();
    const committed = store.commit({
      records: { token: undefined },
      shouldQuarantine: false,
    });
    if (committed.success) throw new Error('expected an undefined record to be refused');
    expect(committed.message).toContain('token');
  });

  it('threat 11: reports a throwing accessor as a failure rather than raising', () => {
    const { store } = makeStore();
    const records: Record<string, unknown> = {};
    Object.defineProperty(records, 'token', {
      enumerable: true,
      get: () => {
        throw new Error(SECRET);
      },
    });
    const committed = store.commit({ records, shouldQuarantine: false });
    if (committed.success) throw new Error('expected a throwing accessor to fail the commit');
    expect(committed.message).not.toContain(SECRET);
  });

  it('counts what it wrote, not what an accessor claimed on the way past', () => {
    const { store, fileSystem } = makeStore();
    const records: Record<string, unknown> = {};
    let reads = 0;
    Object.defineProperty(records, 'token', {
      enumerable: true,
      get: () => {
        reads += 1;
        return reads > 1 ? undefined : 'value';
      },
    });
    const committed = store.commit({ records, shouldQuarantine: false });
    if (!committed.success) throw new Error('expected the first read to be the one committed');
    expect(committed.data.summary).toContain('1 records');
    expect(fileSystem.contentsOf(STORE_PATH)).toContain('value');
  });

  it('threat 8: refuses a payload it would later be unable to read back', () => {
    const { store, fileSystem } = makeStore();
    const oversized = 'x'.repeat(MAX_STORE_BYTES + 1);
    const committed = store.commit({ records: { token: oversized }, shouldQuarantine: false });
    if (committed.success) throw new Error('expected an oversized commit to be refused');
    expect(committed.status).toBe('EFBIG');
    expect(fileSystem.names()).toHaveLength(0);
  });

  it('threat 11: never repeats the token when the records cannot be serialised', () => {
    const { store } = makeStore();
    const circular: Record<string, unknown> = { token: SECRET };
    circular['self'] = circular;
    const committed = store.commit({ records: circular, shouldQuarantine: false });
    expect(committed.success).toBe(false);
    expect(committed.success ? '' : committed.message).not.toContain(SECRET);
  });

  it('writes nothing at all when the records cannot be serialised', () => {
    const { store, fileSystem } = makeStore();
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    store.commit({ records: circular, shouldQuarantine: false });
    expect(fileSystem.names()).toHaveLength(0);
  });

  it('reports where the records landed so the outcome can be logged', () => {
    const { store } = makeStore();
    const committed = store.commit({ records: { a: 'b' }, shouldQuarantine: false });
    expect(committed.success && committed.data.path).toBe(STORE_PATH);
  });

  it('reports that a quarantine happened, so the operator can go looking', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(STORE_PATH, 'corrupt', OWNER_ONLY);
    const committed = store.commit({ records: { a: 'b' }, shouldQuarantine: true });
    if (!committed.success) throw new Error(`expected a commit, got ${committed.message}`);
    expect(committed.data.wasQuarantined).toBe(true);
  });

  it('does not quarantine when the caller did not ask for one', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(STORE_PATH, '{"old":"v"}', OWNER_ONLY);
    const committed = store.commit({ records: { a: 'b' }, shouldQuarantine: false });
    if (!committed.success) throw new Error(`expected a commit, got ${committed.message}`);
    expect(committed.data.wasQuarantined).toBe(false);
  });

  it('skips quarantine when there is no file to move, and still commits', () => {
    const { store, fileSystem } = makeStore();
    const committed = store.commit({ records: { a: 'b' }, shouldQuarantine: true });
    if (!committed.success) throw new Error(`expected a commit, got ${committed.message}`);
    expect(committed.data.wasQuarantined).toBe(false);
    expect(fileSystem.contentsOf(STORE_PATH)).toContain('"a"');
  });

  it('aborts the commit when only the quarantine move fails', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(STORE_PATH, 'corrupt-but-precious', OWNER_ONLY);
    fileSystem.forcedFailuresOnce.set('rename', 'EACCES');
    const committed = store.commit({ records: { token: SECRET }, shouldQuarantine: true });
    expect(committed.success).toBe(false);
    expect(fileSystem.contentsOf(STORE_PATH)).toBe('corrupt-but-precious');
  });

  it('threat 14: removes the staged credential when only the quarantine fails', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(STORE_PATH, 'corrupt-but-precious', OWNER_ONLY);
    fileSystem.forcedFailuresOnce.set('rename', 'EACCES');
    store.commit({ records: { token: SECRET }, shouldQuarantine: true });
    expect(leftovers(fileSystem)).toHaveLength(0);
  });
});
