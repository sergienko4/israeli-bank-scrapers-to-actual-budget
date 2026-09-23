/**
 * An in-memory {@link IFileSystem} for testing store policy.
 *
 * <p>Exists so the layer above can be tested without `vi.mock('node:fs')`,
 * which the mocking guidelines call out as hidden global state. Every errno
 * that matters — `ENOENT`, `ELOOP`, `EEXIST`, `ENOSPC` — can be produced
 * deterministically here, with no volume, no timing and no cleanup.
 *
 * <p>Its fidelity is not taken on trust: `FakeFileSystem.test.ts` runs the
 * same contract suite as the real adapter, so any divergence fails the build.
 */

import type {
  ICloseOutcome, IFileSystem, IHardenOutcome, IMoveOutcome, IOpenFile, IRemoveOutcome,
  IWriteOutcome,
} from '../../src/Storage/FileSystemPort.js';
import type { Procedure } from '../../src/Types/Procedure.js';
import { fail, succeed } from '../../src/Types/ProcedureHelpers.js';

/** What a name points at. Directories and links are never parsed as JSON. */
export type EntryKind = 'file' | 'directory' | 'symlink';

/** One inode: contents and permissions shared by every name pointing at it. */
interface IInode {
  contents: string;
  mode: number;
  modifiedAtMs: number;
}

/** One name in the directory, and what it resolves to. */
interface IEntry {
  kind: EntryKind;
  /** Shared for hard links; undefined for directories. */
  inode?: IInode;
  /** Target name for a symlink, which need not exist. */
  target?: string;
}

/** Owner read/write only, matching the real adapter. */
const OWNER_ONLY = 0o600;

/** In-memory filesystem with injectable failures. */
export default class FakeFileSystem implements IFileSystem {
  private readonly _entries = new Map<string, IEntry>();

  private readonly _open = new Map<number, IEntry>();

  private _nextDescriptor = 3;

  /** Operation names forced to fail, mapped to the errno they raise. */
  public readonly forcedFailures = new Map<string, string>();

  /**
   * Operations forced to fail once only, mapped to the errno they raise.
   *
   * <p>Needed because a commit renames twice. Failing every rename cannot
   * distinguish "the quarantine failed" from "the commit failed", and a guard
   * that only the first case exercises would go untested.
   */
  public readonly forcedFailuresOnce = new Map<string, string>();

  /**
   * Every operation performed, in order.
   *
   * <p>Recorded because the number of path lookups is itself a security
   * property: a check-then-use pair opens a window a single lookup does not.
   */
  public readonly calls: string[] = [];

  /**
   * Paths passed to `createExclusive`, in order.
   *
   * <p>Recorded so a test can assert that staging names are unpredictable,
   * which is policy the real adapter cannot express.
   */
  public readonly stagedPaths: string[] = [];

  /**
   * Creates a regular file, replacing any existing name.
   * @param name - Name to create.
   * @param contents - File contents.
   * @param mode - Permission bits.
   * @returns Nothing.
   */
  public seedFile(name: string, contents: string, mode: number): void {
    const inode: IInode = { contents, mode, modifiedAtMs: Date.now() };
    this._entries.set(name, { kind: 'file', inode });
  }

  /**
   * Backdates a file so a staleness check can be exercised.
   * @param name - Name whose modification time changes.
   * @param whenMs - Milliseconds since the epoch to report.
   * @returns Nothing.
   */
  public setModifiedAt(name: string, whenMs: number): void {
    const entry = this._entries.get(name);
    if (entry?.inode) entry.inode.modifiedAtMs = whenMs;
  }

  /**
   * Creates a directory entry.
   * @param name - Name to create.
   * @returns Nothing.
   */
  public seedDirectory(name: string): void {
    this._entries.set(name, { kind: 'directory' });
  }

  /**
   * Creates a symbolic link, whose target need not exist.
   * @param name - Link name.
   * @param targetName - Name the link points at.
   * @returns Nothing.
   */
  public seedSymlink(name: string, targetName: string): void {
    this._entries.set(name, { kind: 'symlink', target: targetName });
  }

  /**
   * Adds a second name for an existing file's inode.
   * @param existingName - Name whose inode is shared.
   * @param newName - Additional name for that inode.
   * @returns Nothing.
   */
  public seedHardLink(existingName: string, newName: string): void {
    const existing = this._entries.get(existingName);
    if (!existing?.inode) throw new Error(`cannot hard-link missing file ${existingName}`);
    this._entries.set(newName, { kind: 'file', inode: existing.inode });
  }

  /**
   * Counts descriptors still held open.
   * @returns The open count, so a test can prove nothing was leaked.
   */
  public openDescriptorCount(): number {
    return this._open.size;
  }

  /**
   * Lists every name currently present.
   * @returns The names, so a test can prove nothing was left behind.
   */
  public names(): string[] {
    return [...this._entries.keys()];
  }

  /**
   * Reads the permission bits of a name.
   * @param name - Name to inspect.
   * @returns The stored mode, or zero when the name is absent.
   */
  public modeOf(name: string): number {
    return this._entries.get(name)?.inode?.mode ?? 0;
  }

  /**
   * Reports whether a name exists, including as a dangling link.
   * @param name - Name to inspect.
   * @returns True when the name is present.
   */
  public hasEntry(name: string): boolean {
    return this._entries.has(name);
  }

  /**
   * Reads a name's contents, resolving one level of symlink.
   * @param name - Name to read.
   * @returns The contents, or an empty string when unreadable.
   */
  public contentsOf(name: string): string {
    const entry = this._entries.get(name);
    if (entry?.kind === 'symlink') return this.contentsOf(entry.target ?? '');
    return entry?.inode?.contents ?? '';
  }

  /**
   * Counts the names sharing one entry's inode.
   * @param entry - Entry whose inode is counted.
   * @returns The number of names pointing at that inode.
   */
  private linkCountOf(entry: IEntry): number {
    if (!entry.inode) return 1;
    let count = 0;
    for (const candidate of this._entries.values()) {
      if (candidate.inode === entry.inode) count += 1;
    }
    return count;
  }

  /**
   * Returns the forced failure for an operation, if one is armed.
   * @param operation - Operation name.
   * @returns A failure when armed, otherwise undefined.
   */
  private forced(operation: string): ReturnType<typeof fail> | undefined {
    const once = this.forcedFailuresOnce.get(operation);
    if (once !== undefined) {
      this.forcedFailuresOnce.delete(operation);
      return fail(`forced ${operation} failure`, { status: once });
    }
    const code = this.forcedFailures.get(operation);
    if (code === undefined) return undefined;
    return fail(`forced ${operation} failure`, { status: code });
  }

  /**
   * Opens a name without following a final symlink.
   * @param filePath - Name to open.
   * @returns The open file, or a failure carrying the errno in `status`.
   */
  public openForRead(filePath: string): Procedure<IOpenFile> {
    this.calls.push('openForRead');
    const forced = this.forced('openForRead');
    if (forced) return forced;
    const entry = this._entries.get(filePath);
    if (!entry) return fail(`Could not open ${filePath}: ENOENT`, { status: 'ENOENT' });
    if (entry.kind === 'symlink') {
      return fail(`Could not open ${filePath}: ELOOP`, { status: 'ELOOP' });
    }
    const descriptor = this._nextDescriptor;
    this._nextDescriptor += 1;
    this._open.set(descriptor, entry);
    return succeed(this.describe(descriptor, entry));
  }

  /**
   * Builds the facts an open descriptor reports about itself.
   * @param descriptor - Allocated descriptor number.
   * @param entry - Entry the descriptor refers to.
   * @returns The descriptor paired with its stat facts.
   */
  private describe(descriptor: number, entry: IEntry): IOpenFile {
    return {
      descriptor,
      sizeBytes: Buffer.byteLength(entry.inode?.contents ?? '', 'utf8'),
      isRegularFile: entry.kind === 'file',
      linkCount: this.linkCountOf(entry),
      modifiedAtMs: entry.inode?.modifiedAtMs ?? 0,
    };
  }

  /**
   * Reads an open descriptor, refusing to return more than a cap allows.
   * @param file - Descriptor previously returned by `openForRead`.
   * @param maxBytes - Largest payload to accept before failing with `EFBIG`.
   * @returns The contents, or a failure carrying the errno in `status`.
   */
  public readAll(file: IOpenFile, maxBytes: number): Procedure<string> {
    this.calls.push('readAll');
    const forced = this.forced('readAll');
    if (forced) return forced;
    const entry = this._open.get(file.descriptor);
    if (!entry) return fail('Could not read: EBADF', { status: 'EBADF' });
    if (entry.kind !== 'file') return fail('Could not read: EISDIR', { status: 'EISDIR' });
    const contents = entry.inode?.contents ?? '';
    if (Buffer.byteLength(contents, 'utf8') > maxBytes) {
      return fail(`Contents exceed ${String(maxBytes)} bytes`, { status: 'EFBIG' });
    }
    return succeed(contents);
  }

  /**
   * Restricts an open file to owner-only access, refusing shared inodes.
   * @param file - Descriptor previously returned by `openForRead`.
   * @returns The mode now in effect, or a failure explaining why it stands.
   */
  public restrictToOwner(file: IOpenFile): Procedure<IHardenOutcome> {
    this.calls.push('restrictToOwner');
    const current = this._open.get(file.descriptor);
    if (current && this.linkCountOf(current) > 1) {
      return fail('Refusing to change permissions on a hard-linked file', { status: 'EMLINK' });
    }
    const forced = this.forced('restrictToOwner');
    if (forced) return forced;
    const entry = this._open.get(file.descriptor);
    if (!entry?.inode) return fail('Could not harden: EBADF', { status: 'EBADF' });
    entry.inode.mode = OWNER_ONLY;
    return succeed({ mode: OWNER_ONLY });
  }

  /**
   * Releases a descriptor.
   * @param file - Descriptor previously returned by `openForRead`.
   * @returns Whether the descriptor was released cleanly.
   */
  public close(file: IOpenFile): ICloseOutcome {
    this.calls.push('close');
    return { wasClosed: this._open.delete(file.descriptor) };
  }

  /**
   * Creates a new owner-only file, refusing a path that is already taken.
   * @param filePath - Name to create.
   * @param contents - Payload to write.
   * @returns The bytes staged, or a failure carrying the errno in `status`.
   */
  public createExclusive(filePath: string, contents: string): Procedure<IWriteOutcome> {
    this.calls.push('createExclusive');
    this.stagedPaths.push(filePath);
    const forced = this.forced('createExclusive');
    if (forced) return forced;
    if (this._entries.has(filePath)) {
      return fail(`Could not create ${filePath}: EEXIST`, { status: 'EEXIST' });
    }
    this.seedFile(filePath, contents, OWNER_ONLY);
    return succeed({ bytesWritten: Buffer.byteLength(contents, 'utf8') });
  }

  /**
   * Moves a name onto another, replacing the destination.
   * @param fromPath - Existing name to move.
   * @param toPath - Destination, replaced if it exists.
   * @returns The destination path, or a failure carrying the errno.
   */
  public rename(fromPath: string, toPath: string): Procedure<IMoveOutcome> {
    this.calls.push('rename');
    const forced = this.forced('rename');
    if (forced) return forced;
    const entry = this._entries.get(fromPath);
    if (!entry) return fail(`Could not rename ${fromPath}: ENOENT`, { status: 'ENOENT' });
    if (this._entries.get(toPath)?.kind === 'directory') {
      return fail(`Could not rename onto ${toPath}: EISDIR`, { status: 'EISDIR' });
    }
    this._entries.set(toPath, entry);
    this._entries.delete(fromPath);
    return succeed({ path: toPath });
  }

  /**
   * Lists the full paths of everything directly inside a directory.
   * @param directoryPath - Directory to list.
   * @returns The paths, or a failure carrying the errno in `status`.
   */
  public listNames(directoryPath: string): Procedure<readonly string[]> {
    this.calls.push('listNames');
    const forced = this.forced('listNames');
    if (forced) return forced;
    const directory = this._entries.get(directoryPath);
    if (directory?.kind !== 'directory') {
      return fail(`Could not list ${directoryPath}: ENOENT`, { status: 'ENOENT' });
    }
    const prefix = directoryPath.endsWith('/') ? directoryPath : `${directoryPath}/`;
    const names = [...this._entries.keys()]
      .filter((name) => name.startsWith(prefix) && !name.slice(prefix.length).includes('/'));
    return succeed(names);
  }

  /**
   * Removes a name, treating an already-absent name as success.
   * @param filePath - Name to remove.
   * @returns Whether anything was deleted, or why the name remains.
   */
  public remove(filePath: string): Procedure<IRemoveOutcome> {
    this.calls.push('remove');
    const forced = this.forced('remove');
    if (forced) return forced;
    if (this._entries.get(filePath)?.kind === 'directory') {
      return fail(`Could not remove ${filePath}: EISDIR`, { status: 'EISDIR' });
    }
    const wasPresent = this._entries.delete(filePath);
    return succeed({ wasPresent });
  }
}
