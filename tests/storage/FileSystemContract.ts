/**
 * One behavioural specification for {@link IFileSystem}, run against every
 * implementation.
 *
 * <p>The in-memory double exists so store policy can be tested without
 * mocking `node:fs` globally. That is only worth doing if the double behaves
 * like the real thing, so both run these identical expectations: drift
 * becomes a failing test instead of a silent lie in every test above it.
 *
 * <p>Arrangement and inspection go through {@link IContractWorld} because the
 * two implementations keep their state in different places — one on a real
 * volume, one in a map. The assertions themselves only ever touch the port.
 *
 * <p>Cases that can only be proved against real syscalls — a FIFO that must
 * not block the process — deliberately live in the adapter's own suite
 * instead, since an in-memory double cannot meaningfully block.
 */

import { describe, expect, it } from 'vitest';

import type { IFileSystem, IOpenFile } from '../../src/Storage/FileSystemPort.js';

/** Arranges and inspects filesystem state for whichever world is under test. */
export interface IContractWorld {
  /** Resolves a bare name to a path valid in this world. */
  path(name: string): string;
  /** The directory that {@link IContractWorld.path} resolves names into. */
  directory(): string;
  /** Creates a regular file with explicit contents and permissions. */
  writeFile(name: string, contents: string, mode: number): void;
  /** Creates a symbolic link pointing at a target name, which may not exist. */
  makeSymlink(name: string, targetName: string): void;
  /** Creates a directory. */
  makeDir(name: string): void;
  /** Adds a second name for an existing file's inode. */
  makeHardLink(existingName: string, newName: string): void;
  /** Reports the permission bits of a name, following nothing. */
  modeOf(name: string): number;
  /** Reports whether a name exists at all, including as a dangling link. */
  hasEntry(name: string): boolean;
  /** Reads a name's contents, following links, for leak assertions. */
  contentsOf(name: string): string;
}

/** A world plus the port implementation that operates on it. */
export interface IContractSubject {
  /** The implementation under test. */
  fileSystem: IFileSystem;
  /** State arrangement for that implementation. */
  world: IContractWorld;
}

/**
 * Registers the shared contract suite for one implementation.
 * @param name - Implementation name, used in the describe block.
 * @param makeSubject - Builds a fresh subject for each test.
 * @returns Nothing; registers tests as a side effect.
 */
export function describeFileSystemContract(
  name: string,
  makeSubject: () => IContractSubject,
): void {
  describe(`${name} satisfies the IFileSystem contract`, () => {
    describeOpenForRead(makeSubject);
    describeReadAll(makeSubject);
    describeRestrictToOwner(makeSubject);
    describeClose(makeSubject);
    describeCreateExclusive(makeSubject);
    describeRenameAndRemove(makeSubject);
    describeListNames(makeSubject);
  });
}

/**
 * A descriptor no implementation ever hands out.
 *
 * <p>Deliberately not a closed descriptor: the operating system recycles those
 * numbers, so hardening one risks re-permissioning an unrelated open file.
 */
/**
 * Read cap used by the shared cases.
 *
 * <p>Small on purpose: the production cap is 8 MiB, and asserting the
 * boundary at that size would allocate megabytes in every implementation.
 * The cap is a parameter precisely so the boundary can be tested cheaply.
 */
const CAP = 64;

const NEVER_ISSUED: IOpenFile = {
  descriptor: 2_147_483_647,
  sizeBytes: 0,
  isRegularFile: true,
  linkCount: 1,
  modifiedAtMs: 0,
};

/**
 * Covers opening a path, which must never follow a final symlink.
 * @param makeSubject - Builds a fresh subject for each test.
 * @returns Nothing; registers tests as a side effect.
 */
function describeOpenForRead(makeSubject: () => IContractSubject): void {
  describe('openForRead', () => {
    it('opens a regular file and reports it as one', () => {
      const { fileSystem, world } = makeSubject();
      world.writeFile('store.json', '{"a":1}', 0o600);
      const opened = fileSystem.openForRead(world.path('store.json'));
      expect(opened.success).toBe(true);
      if (!opened.success) return;
      expect(opened.data.isRegularFile).toBe(true);
      fileSystem.close(opened.data);
    });

    it('reports the size, so an implausibly large file can be refused', () => {
      const { fileSystem, world } = makeSubject();
      world.writeFile('store.json', 'abcdef', 0o600);
      const opened = fileSystem.openForRead(world.path('store.json'));
      if (!opened.success) throw new Error('expected the open to succeed');
      expect(opened.data.sizeBytes).toBe(6);
      fileSystem.close(opened.data);
    });

    it('measures size in bytes, not characters, so the cap means one thing', () => {
      const { fileSystem, world } = makeSubject();
      world.writeFile('store.json', 'שלום', 0o600);
      const opened = fileSystem.openForRead(world.path('store.json'));
      if (!opened.success) throw new Error('expected the open to succeed');
      fileSystem.close(opened.data);
      expect(opened.data.sizeBytes).toBe(8);
    });

    it('reports a single name for an ordinary file', () => {
      const { fileSystem, world } = makeSubject();
      world.writeFile('store.json', '{}', 0o600);
      const opened = fileSystem.openForRead(world.path('store.json'));
      if (!opened.success) throw new Error('expected the open to succeed');
      expect(opened.data.linkCount).toBe(1);
      fileSystem.close(opened.data);
    });

    it('counts every name pointing at a hard-linked inode', () => {
      const { fileSystem, world } = makeSubject();
      world.writeFile('victim.txt', 'not ours', 0o644);
      world.makeHardLink('victim.txt', 'store.json');
      const opened = fileSystem.openForRead(world.path('store.json'));
      if (!opened.success) throw new Error('expected the open to succeed');
      expect(opened.data.linkCount).toBeGreaterThan(1);
      fileSystem.close(opened.data);
    });

    it('reports an absent path as ENOENT, the one code meaning "nothing here"', () => {
      const { fileSystem, world } = makeSubject();
      const opened = fileSystem.openForRead(world.path('store.json'));
      expect(opened.success).toBe(false);
      if (opened.success) return;
      expect(opened.status).toBe('ENOENT');
    });

    it('refuses a symlink rather than following it to another file', () => {
      const { fileSystem, world } = makeSubject();
      world.writeFile('someone-elses-secrets.json', '{"theirs":true}', 0o600);
      world.makeSymlink('store.json', 'someone-elses-secrets.json');
      const opened = fileSystem.openForRead(world.path('store.json'));
      expect(opened.success).toBe(false);
    });

    it('threat 1: never reports a symlink as absent, which would license overwriting it', () => {
      const { fileSystem, world } = makeSubject();
      world.makeSymlink('store.json', 'nowhere.json');
      const opened = fileSystem.openForRead(world.path('store.json'));
      if (opened.success) throw new Error('expected the open to fail');
      expect(opened.status).not.toBe('ENOENT');
    });

    it('reports a modification time that a staleness check can use', () => {
      const { fileSystem, world } = makeSubject();
      const before = Date.now() - 1_000;
      world.writeFile('store.json', '{}', 0o600);
      const opened = fileSystem.openForRead(world.path('store.json'));
      if (!opened.success) throw new Error('expected the open to succeed');
      expect(opened.data.modifiedAtMs).toBeGreaterThanOrEqual(before);
      fileSystem.close(opened.data);
    });

    it('never lets a directory pass as a regular file, however it is reported', () => {
      const { fileSystem, world } = makeSubject();
      world.makeDir('store.json');
      const opened = fileSystem.openForRead(world.path('store.json'));
      if (!opened.success) {
        expect(opened.status).not.toBe('ENOENT');
        return;
      }
      expect(opened.data.isRegularFile).toBe(false);
      fileSystem.close(opened.data);
    });
  });
}

/**
 * Covers reading an open descriptor.
 * @param makeSubject - Builds a fresh subject for each test.
 * @returns Nothing; registers tests as a side effect.
 */
function describeReadAll(makeSubject: () => IContractSubject): void {
  describe('readAll', () => {
    it('returns the exact bytes written, so JSON survives a round trip', () => {
      const { fileSystem, world } = makeSubject();
      const payload = '{"banks":{"oneZero":{"token":"header.payload.sig"}}}';
      world.writeFile('store.json', payload, 0o600);
      const opened = fileSystem.openForRead(world.path('store.json'));
      if (!opened.success) throw new Error('expected the open to succeed');
      const read = fileSystem.readAll(opened.data, CAP);
      fileSystem.close(opened.data);
      expect(read.success && read.data).toBe(payload);
    });

    it('reports an unusable descriptor rather than throwing', () => {
      const { fileSystem } = makeSubject();
      const read = fileSystem.readAll(NEVER_ISSUED, CAP);
      expect(read.success).toBe(false);
    });

    it('returns an empty string for an empty file rather than failing', () => {
      const { fileSystem, world } = makeSubject();
      world.writeFile('store.json', '', 0o600);
      const opened = fileSystem.openForRead(world.path('store.json'));
      if (!opened.success) throw new Error('expected the open to succeed');
      const read = fileSystem.readAll(opened.data, CAP);
      fileSystem.close(opened.data);
      expect(read.success && read.data).toBe('');
    });

    it('threat 8: accepts a payload sitting exactly on the cap', () => {
      const { fileSystem, world } = makeSubject();
      const payload = 'x'.repeat(CAP);
      world.writeFile('store.json', payload, 0o600);
      const opened = fileSystem.openForRead(world.path('store.json'));
      if (!opened.success) throw new Error('expected the open to succeed');
      const read = fileSystem.readAll(opened.data, CAP);
      fileSystem.close(opened.data);
      expect(read.success && read.data.length).toBe(CAP);
    });

    it('threat 8: refuses a payload one byte past the cap, whatever fstat said', () => {
      const { fileSystem, world } = makeSubject();
      world.writeFile('store.json', 'x'.repeat(CAP + 1), 0o600);
      const opened = fileSystem.openForRead(world.path('store.json'));
      if (!opened.success) throw new Error('expected the open to succeed');
      const read = fileSystem.readAll(opened.data, CAP);
      fileSystem.close(opened.data);
      if (read.success) throw new Error('expected the oversized read to be refused');
      expect(read.status).toBe('EFBIG');
    });
  });
}

/**
 * Covers owner-only hardening, which must never touch a shared inode.
 * @param makeSubject - Builds a fresh subject for each test.
 * @returns Nothing; registers tests as a side effect.
 */
function describeRestrictToOwner(makeSubject: () => IContractSubject): void {
  describe('restrictToOwner', () => {
    it('threat 7: takes a world-readable store down to owner-only', () => {
      const { fileSystem, world } = makeSubject();
      world.writeFile('store.json', '{}', 0o644);
      const opened = fileSystem.openForRead(world.path('store.json'));
      if (!opened.success) throw new Error('expected the open to succeed');
      const hardened = fileSystem.restrictToOwner(opened.data);
      fileSystem.close(opened.data);
      expect(hardened.success && hardened.data.mode).toBe(0o600);
      expect(world.modeOf('store.json') & 0o777).toBe(0o600);
    });

    it('reports an unusable descriptor rather than throwing', () => {
      const { fileSystem } = makeSubject();
      const hardened = fileSystem.restrictToOwner(NEVER_ISSUED);
      expect(hardened.success).toBe(false);
    });

    it('threat 6: refuses a link created after the file was opened', () => {
      const { fileSystem, world } = makeSubject();
      world.writeFile('store.json', '{"a":"b"}', 0o644);
      const opened = fileSystem.openForRead(world.path('store.json'));
      if (!opened.success) throw new Error('expected the open to succeed');
      world.makeHardLink('store.json', 'attacker-link.json');
      const hardened = fileSystem.restrictToOwner(opened.data);
      fileSystem.close(opened.data);
      expect(hardened.success).toBe(false);
      expect(world.modeOf('store.json') & 0o777).toBe(0o644);
    });

    it('threat 6: refuses a hard-linked inode instead of re-permissioning a stranger', () => {
      const { fileSystem, world } = makeSubject();
      world.writeFile('victim.txt', 'not ours', 0o644);
      world.makeHardLink('victim.txt', 'store.json');
      const opened = fileSystem.openForRead(world.path('store.json'));
      if (!opened.success) throw new Error('expected the open to succeed');
      const hardened = fileSystem.restrictToOwner(opened.data);
      fileSystem.close(opened.data);
      expect(hardened.success).toBe(false);
      expect(world.modeOf('victim.txt') & 0o777).toBe(0o644);
    });
  });
}

/**
 * Covers directory listing, which the stale-staging sweep depends on.
 * @param makeSubject - Builds a fresh subject for each test.
 * @returns Nothing; registers tests as a side effect.
 */
function describeListNames(makeSubject: () => IContractSubject): void {
  describe('listNames', () => {
    it('returns full paths, so no caller has to join a separator itself', () => {
      const { fileSystem, world } = makeSubject();
      world.writeFile('store.json', '{}', 0o600);
      const listed = fileSystem.listNames(world.directory());
      expect(listed.success && listed.data).toContain(world.path('store.json'));
    });

    it('lists every name present, including leftovers from a crashed run', () => {
      const { fileSystem, world } = makeSubject();
      world.writeFile('store.json', '{}', 0o600);
      world.writeFile('store.json.abc.tmp', '{}', 0o600);
      const listed = fileSystem.listNames(world.directory());
      expect(listed.success && listed.data).toHaveLength(2);
    });

    it('returns an empty list for an empty directory rather than failing', () => {
      const { fileSystem, world } = makeSubject();
      const listed = fileSystem.listNames(world.directory());
      expect(listed.success && listed.data).toHaveLength(0);
    });

    it('reports a missing directory rather than throwing', () => {
      const { fileSystem, world } = makeSubject();
      const listed = fileSystem.listNames(world.path('no-such-directory'));
      expect(listed.success).toBe(false);
    });
  });
}

/**
 * Covers descriptor release, whose report is how a double-release is noticed.
 * @param makeSubject - Builds a fresh subject for each test.
 * @returns Nothing; registers tests as a side effect.
 */
function describeClose(makeSubject: () => IContractSubject): void {
  describe('close', () => {
    it('reports a live descriptor as released', () => {
      const { fileSystem, world } = makeSubject();
      world.writeFile('store.json', '{}', 0o600);
      const opened = fileSystem.openForRead(world.path('store.json'));
      if (!opened.success) throw new Error('expected the open to succeed');
      expect(fileSystem.close(opened.data).wasClosed).toBe(true);
    });

    it('reports a second release as a no-op rather than claiming success', () => {
      const { fileSystem, world } = makeSubject();
      world.writeFile('store.json', '{}', 0o600);
      const opened = fileSystem.openForRead(world.path('store.json'));
      if (!opened.success) throw new Error('expected the open to succeed');
      fileSystem.close(opened.data);
      expect(fileSystem.close(opened.data).wasClosed).toBe(false);
    });
  });
}

/**
 * Covers exclusive creation, the guard that keeps a staged secret private.
 * @param makeSubject - Builds a fresh subject for each test.
 * @returns Nothing; registers tests as a side effect.
 */
function describeCreateExclusive(makeSubject: () => IContractSubject): void {
  describe('createExclusive', () => {
    it('creates the file owner-only, never at the process umask', () => {
      const { fileSystem, world } = makeSubject();
      const created = fileSystem.createExclusive(world.path('staged.tmp'), '{}');
      expect(created.success).toBe(true);
      expect(world.modeOf('staged.tmp') & 0o777).toBe(0o600);
    });

    it('reports the byte count staged, so a short write cannot pass as whole', () => {
      const { fileSystem, world } = makeSubject();
      const payload = '{"token":"\u00e9"}';
      const created = fileSystem.createExclusive(world.path('staged.tmp'), payload);
      expect(created.success && created.data.bytesWritten).toBe(Buffer.byteLength(payload, 'utf8'));
    });

    it('refuses a path that is already taken, and leaves it untouched', () => {
      const { fileSystem, world } = makeSubject();
      world.writeFile('staged.tmp', 'someone got here first', 0o644);
      const created = fileSystem.createExclusive(world.path('staged.tmp'), '{}');
      expect(created.success).toBe(false);
      if (created.success) return;
      expect(created.status).toBe('EEXIST');
      expect(world.contentsOf('staged.tmp')).toBe('someone got here first');
    });

    it('threat 2: never writes the payload through a symlink planted at the path', () => {
      const { fileSystem, world } = makeSubject();
      world.writeFile('someone-elses-secrets.json', 'theirs', 0o644);
      world.makeSymlink('staged.tmp', 'someone-elses-secrets.json');
      const created = fileSystem.createExclusive(world.path('staged.tmp'), 'our-token');
      expect(created.success).toBe(false);
      expect(world.contentsOf('someone-elses-secrets.json')).toBe('theirs');
    });
  });
}

/**
 * Covers the commit and cleanup operations.
 * @param makeSubject - Builds a fresh subject for each test.
 * @returns Nothing; registers tests as a side effect.
 */
function describeRenameAndRemove(makeSubject: () => IContractSubject): void {
  describe('rename and remove', () => {
    it('refuses to commit onto a directory rather than reporting a false success', () => {
      const { fileSystem, world } = makeSubject();
      world.writeFile('staged.tmp', 'ours', 0o600);
      world.makeDir('store.json');
      const moved = fileSystem.rename(world.path('staged.tmp'), world.path('store.json'));
      expect(moved.success).toBe(false);
      expect(world.contentsOf('staged.tmp')).toBe('ours');
    });

    it('refuses to remove a directory, which is never a file this store staged', () => {
      const { fileSystem, world } = makeSubject();
      world.makeDir('not-a-file');
      const removed = fileSystem.remove(world.path('not-a-file'));
      expect(removed.success).toBe(false);
      expect(world.hasEntry('not-a-file')).toBe(true);
    });

    it('replaces the destination, which is what makes the commit atomic', () => {
      const { fileSystem, world } = makeSubject();
      world.writeFile('staged.tmp', 'new', 0o600);
      world.writeFile('store.json', 'old', 0o600);
      const moved = fileSystem.rename(world.path('staged.tmp'), world.path('store.json'));
      expect(moved.success && moved.data.path).toBe(world.path('store.json'));
      expect(world.contentsOf('store.json')).toBe('new');
      expect(world.hasEntry('staged.tmp')).toBe(false);
    });

    it('reports a missing source rather than throwing', () => {
      const { fileSystem, world } = makeSubject();
      const moved = fileSystem.rename(world.path('absent.tmp'), world.path('store.json'));
      expect(moved.success).toBe(false);
    });

    it('removes a staged file so a live credential does not linger', () => {
      const { fileSystem, world } = makeSubject();
      world.writeFile('staged.tmp', 'token', 0o600);
      const removed = fileSystem.remove(world.path('staged.tmp'));
      if (!removed.success) throw new Error('expected the removal to succeed');
      expect(removed.data.wasPresent).toBe(true);
      expect(world.hasEntry('staged.tmp')).toBe(false);
    });

    it('treats removing an absent path as success, so cleanup is idempotent', () => {
      const { fileSystem, world } = makeSubject();
      const removed = fileSystem.remove(world.path('absent.tmp'));
      if (!removed.success) throw new Error('expected removing an absent path to succeed');
      expect(removed.data.wasPresent).toBe(false);
    });
  });
}
