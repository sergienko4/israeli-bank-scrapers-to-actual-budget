/**
 * Leftover-staging behaviour of {@link SecureJsonStore}.
 *
 * <p>Staging is exclusive and cleanup is best effort, but neither survives a
 * `SIGKILL` landing between the two. That leaves a file holding a live token
 * under a name nothing will ever revisit. These tests pin down the sweep that
 * collects it, and — more importantly — the three things it must never touch:
 * a concurrent commit's staging file, a quarantined salvage, and the store.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IRemoveOutcome } from '../../src/Storage/FileSystemPort.js';
import SecureJsonStore, { STALE_STAGING_AGE_MS } from '../../src/Storage/SecureJsonStore.js';
import type { Procedure } from '../../src/Types/Procedure.js';
import { succeed } from '../../src/Types/ProcedureHelpers.js';
import FakeFileSystem from './FakeFileSystem.js';

/**
 * A filesystem where another sweeper always deletes the file first.
 *
 * <p>Models the one race two sweepers can lose: both see the same stale
 * file, one unlinks it, and the other is told the path is already gone.
 */
class ThrowsOnRemoveFileSystem extends FakeFileSystem {
  /**
   * Raises instead of reporting a failure, as a real adapter might.
   * @param filePath - Path to remove.
   * @returns Never; always throws.
   */
  public override remove(filePath: string): Procedure<IRemoveOutcome> {
    throw new Error(`cannot remove ${filePath}`);
  }
}

/**
 * A filesystem where another sweeper always deletes the file first.
 *
 * <p>Models the one race two sweepers can lose: both see the same stale
 * file, one unlinks it, and the other is told the path is already gone.
 */
class LosesTheRaceFileSystem extends FakeFileSystem {
  /**
   * Reports every removal as a path that was already absent.
   * @param filePath - Path to remove.
   * @returns Success, with nothing having been present to remove.
   */
  public override remove(filePath: string): Procedure<IRemoveOutcome> {
    super.remove(filePath);
    return succeed({ wasPresent: false });
  }
}

/** Directory the store and its staged files share. */
const STORE_DIRECTORY = '/data';

/** Path the store under test is bound to. */
const STORE_PATH = `${STORE_DIRECTORY}/tokens.json`;

/** Owner-only, the mode every staged file is created with. */
const OWNER_ONLY = 0o600;

/** A fixed "now" so staleness is a property of the test, not the clock. */
const NOW = 1_700_000_000_000;

/** A token of the shape `randomUUID` produces, which is what a sweep accepts. */
const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

/** A second, so "every leftover" means more than one. */
const OTHER_UUID = '9f8b7c6d-1e2f-4a3b-8c9d-0e1f2a3b4c5d';

/**
 * Builds a store over a fake filesystem with the store directory present.
 * @returns The store and the filesystem behind it.
 */
function makeSubject(): { store: SecureJsonStore; fileSystem: FakeFileSystem } {
  const fileSystem = new FakeFileSystem();
  fileSystem.seedDirectory(STORE_DIRECTORY);
  return { store: new SecureJsonStore(fileSystem, STORE_PATH), fileSystem };
}

/**
 * Seeds a staged file and backdates it by a chosen age.
 * @param fileSystem - Filesystem to seed.
 * @param name - Full path of the staged file.
 * @param ageMs - How long ago it was last written.
 * @returns Nothing.
 */
function seedStagedAged(fileSystem: FakeFileSystem, name: string, ageMs: number): void {
  fileSystem.seedFile(name, '{"oneZero":{"token":"live-secret"}}', OWNER_ONLY);
  fileSystem.setModifiedAt(name, NOW - ageMs);
}

describe('SecureJsonStore leftover staging', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Pins the clock so ages are exact rather than nearly right.
   * @returns Nothing.
   */
  function freezeClock(): void {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
  }

  it('threat 14: removes a staged token abandoned by an earlier crash', () => {
    const { store, fileSystem } = makeSubject();
    freezeClock();
    const abandoned = `${STORE_PATH}.${UUID}.tmp`;
    seedStagedAged(fileSystem, abandoned, STALE_STAGING_AGE_MS + 1);
    const swept = store.sweepStagedLeftovers();
    expect(swept.success && swept.data.removedCount).toBe(1);
    expect(fileSystem.hasEntry(abandoned)).toBe(false);
  });

  it('leaves a staged file that another commit is still using', () => {
    const { store, fileSystem } = makeSubject();
    freezeClock();
    const inFlight = `${STORE_PATH}.${UUID}.tmp`;
    seedStagedAged(fileSystem, inFlight, STALE_STAGING_AGE_MS - 1);
    const swept = store.sweepStagedLeftovers();
    if (!swept.success) throw new Error('expected the sweep to succeed');
    expect(swept.data.removedCount).toBe(0);
    expect(fileSystem.hasEntry(inFlight)).toBe(true);
  });

  it('treats a file exactly on the threshold as still in flight', () => {
    const { store, fileSystem } = makeSubject();
    freezeClock();
    const borderline = `${STORE_PATH}.${UUID}.tmp`;
    seedStagedAged(fileSystem, borderline, STALE_STAGING_AGE_MS);
    store.sweepStagedLeftovers();
    expect(fileSystem.hasEntry(borderline)).toBe(true);
  });

  it('never sweeps a quarantined store, which is the only copy of its bytes', () => {
    const { store, fileSystem } = makeSubject();
    freezeClock();
    const salvaged = `${STORE_PATH}.quarantined-2023-11-14-${UUID}`;
    seedStagedAged(fileSystem, salvaged, STALE_STAGING_AGE_MS * 100);
    const swept = store.sweepStagedLeftovers();
    expect(swept.success && swept.data.removedCount).toBe(0);
    expect(fileSystem.hasEntry(salvaged)).toBe(true);
  });

  it('never sweeps the store itself, however long since it was written', () => {
    const { store, fileSystem } = makeSubject();
    freezeClock();
    seedStagedAged(fileSystem, STORE_PATH, STALE_STAGING_AGE_MS * 100);
    store.sweepStagedLeftovers();
    expect(fileSystem.hasEntry(STORE_PATH)).toBe(true);
  });

  it('never sweeps a neighbouring store that shares the directory', () => {
    const { store, fileSystem } = makeSubject();
    freezeClock();
    const neighbour = `${STORE_DIRECTORY}/other.json.${UUID}.tmp`;
    seedStagedAged(fileSystem, neighbour, STALE_STAGING_AGE_MS * 100);
    store.sweepStagedLeftovers();
    expect(fileSystem.hasEntry(neighbour)).toBe(true);
  });

  it('never sweeps a neighbouring store whose name extends this one', () => {
    const { store, fileSystem } = makeSubject();
    freezeClock();
    const neighbourStage = `${STORE_PATH}.backup.${UUID}.tmp`;
    seedStagedAged(fileSystem, neighbourStage, STALE_STAGING_AGE_MS * 100);
    const swept = store.sweepStagedLeftovers();
    expect(swept.success && swept.data.removedCount).toBe(0);
    expect(fileSystem.hasEntry(neighbourStage)).toBe(true);
  });

  it('ignores a staging-looking name whose token was never one we issued', () => {
    const { store, fileSystem } = makeSubject();
    freezeClock();
    const impostor = `${STORE_PATH}.notes.tmp`;
    seedStagedAged(fileSystem, impostor, STALE_STAGING_AGE_MS * 100);
    const swept = store.sweepStagedLeftovers();
    expect(swept.success && swept.data.removedCount).toBe(0);
    expect(fileSystem.hasEntry(impostor)).toBe(true);
  });

  it('threat 1: skips a symlink planted in the staging namespace', () => {
    const { store, fileSystem } = makeSubject();
    freezeClock();
    fileSystem.seedFile('/data/someone-elses.json', 'theirs', OWNER_ONLY);
    fileSystem.seedSymlink(`${STORE_PATH}.${UUID}.tmp`, '/data/someone-elses.json');
    const swept = store.sweepStagedLeftovers();
    expect(swept.success && swept.data.removedCount).toBe(0);
    expect(fileSystem.hasEntry('/data/someone-elses.json')).toBe(true);
  });

  it('skips a directory wearing a staging name rather than trying to remove it', () => {
    const { store, fileSystem } = makeSubject();
    freezeClock();
    const impostor = `${STORE_PATH}.${UUID}.tmp`;
    fileSystem.seedDirectory(impostor);
    const swept = store.sweepStagedLeftovers();
    expect(swept.success && swept.data.removedCount).toBe(0);
    expect(fileSystem.calls).not.toContain('remove');
    expect(fileSystem.hasEntry(impostor)).toBe(true);
  });

  it('removes every stale leftover, not just the first one it finds', () => {
    const { store, fileSystem } = makeSubject();
    freezeClock();
    seedStagedAged(fileSystem, `${STORE_PATH}.${UUID}.tmp`, STALE_STAGING_AGE_MS + 1);
    seedStagedAged(fileSystem, `${STORE_PATH}.${OTHER_UUID}.tmp`, STALE_STAGING_AGE_MS + 1);
    const swept = store.sweepStagedLeftovers();
    expect(swept.success && swept.data.removedCount).toBe(2);
  });

  it('does not claim a removal that a concurrent sweeper got to first', () => {
    const fileSystem = new LosesTheRaceFileSystem();
    fileSystem.seedDirectory(STORE_DIRECTORY);
    const store = new SecureJsonStore(fileSystem, STORE_PATH);
    freezeClock();
    seedStagedAged(fileSystem, `${STORE_PATH}.${UUID}.tmp`, STALE_STAGING_AGE_MS + 1);
    const swept = store.sweepStagedLeftovers();
    expect(swept.success && swept.data.removedCount).toBe(0);
  });

  it('survives an adapter that raises instead of reporting a failed removal', () => {
    const fileSystem = new ThrowsOnRemoveFileSystem();
    fileSystem.seedDirectory(STORE_DIRECTORY);
    const store = new SecureJsonStore(fileSystem, STORE_PATH);
    freezeClock();
    seedStagedAged(fileSystem, `${STORE_PATH}.${UUID}.tmp`, STALE_STAGING_AGE_MS + 1);
    const swept = store.sweepStagedLeftovers();
    expect(swept.success && swept.data.removedCount).toBe(0);
  });

  it('reports a directory it cannot list rather than claiming a clean sweep', () => {
    const { store, fileSystem } = makeSubject();
    freezeClock();
    fileSystem.forcedFailures.set('listNames', 'EACCES');
    const swept = store.sweepStagedLeftovers();
    expect(swept.success).toBe(false);
  });

  it('releases every descriptor it opens while judging staleness', () => {
    const { store, fileSystem } = makeSubject();
    freezeClock();
    seedStagedAged(fileSystem, `${STORE_PATH}.${UUID}.tmp`, STALE_STAGING_AGE_MS - 1);
    store.sweepStagedLeftovers();
    expect(fileSystem.openDescriptorCount()).toBe(0);
  });

  it('sweeps after a commit, so the crash before this one is cleaned up', () => {
    const { store, fileSystem } = makeSubject();
    freezeClock();
    const abandoned = `${STORE_PATH}.${UUID}.tmp`;
    seedStagedAged(fileSystem, abandoned, STALE_STAGING_AGE_MS + 1);
    const committed = store.commit({ records: { oneZero: 'fresh' }, shouldQuarantine: false });
    expect(committed.success).toBe(true);
    expect(fileSystem.hasEntry(abandoned)).toBe(false);
  });

  it('still reports a successful commit when the sweep cannot run', () => {
    const { store, fileSystem } = makeSubject();
    freezeClock();
    fileSystem.forcedFailures.set('listNames', 'EACCES');
    const committed = store.commit({ records: { oneZero: 'fresh' }, shouldQuarantine: false });
    expect(committed.success).toBe(true);
    expect(fileSystem.contentsOf(STORE_PATH)).toContain('fresh');
  });
  it('threat 30: leaves a staged file it could not cleanly inspect for the next sweep', () => {
    const { store, fileSystem } = makeSubject();
    freezeClock();
    const abandoned = `${STORE_PATH}.${UUID}.tmp`;
    seedStagedAged(fileSystem, abandoned, STALE_STAGING_AGE_MS + 1);
    fileSystem.forcedFailuresOnce.set('close', 'EIO');
    const refused = store.sweepStagedLeftovers();
    expect(refused.success && refused.data.removedCount).toBe(0);
    expect(fileSystem.hasEntry(abandoned)).toBe(true);
    const retried = store.sweepStagedLeftovers();
    expect(retried.success && retried.data.removedCount).toBe(1);
  });
  it('leaves a staged file whose age cannot be measured', () => {
    const { store, fileSystem } = makeSubject();
    freezeClock();
    const unmeasured = `${STORE_PATH}.${UUID}.tmp`;
    seedStagedAged(fileSystem, unmeasured, Number.NaN);
    const swept = store.sweepStagedLeftovers();
    expect(swept.success && swept.data.removedCount).toBe(0);
    expect(fileSystem.hasEntry(unmeasured)).toBe(true);
  });
});
