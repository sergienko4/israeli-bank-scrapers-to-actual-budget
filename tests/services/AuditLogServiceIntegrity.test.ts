/**
 * How {@link AuditLogService} keeps its file safe on the shared volume.
 *
 * <p>The log sits on {@link SecureJsonStore}: the file is owner-only and
 * holds one `entries` record, a list an older release wrote is read and then
 * written back in the records form, and a file holding anything the log would
 * not write back is moved aside on the next record. A run the readers skip
 * (#727) is still written back, so it never makes the file look damaged.
 */

import { describe, expect, it } from 'vitest';

import { AuditLogService } from '../../src/Services/AuditLogService.js';
import FakeFileSystem from '../storage/FakeFileSystem.js';
import seedStaleStaged from '../storage/StaleStaging.js';
import { fakeImportSummary } from '../helpers/factories.js';

/** Path every case reads and writes. */
const AUDIT_PATH = '/data/audit-log.json';

/** A predecessor moved aside by a quarantining commit. */
const QUARANTINED = /^\/data\/audit-log\.json\.quarantined-/;

/** Runs the readers skip, as an older release or a hand edit can leave them. */
const UNREADABLE_RUNS = [{ timestamp: 'x' }, null];

/**
 * Builds a log over a fresh in-memory filesystem, optionally seeding the file.
 * @param contents - File contents to seed, or undefined for no file.
 * @returns The log under test and the filesystem behind it.
 */
function makeLog(contents?: string): { log: AuditLogService; fileSystem: FakeFileSystem } {
  const fileSystem = new FakeFileSystem();
  if (contents !== undefined) fileSystem.seedFile(AUDIT_PATH, contents, 0o644);
  const log = new AuditLogService(fileSystem, AUDIT_PATH, 5);
  return { log, fileSystem };
}

/**
 * Lists the quarantined predecessors on the filesystem.
 * @param fileSystem - Filesystem to inspect.
 * @returns Every quarantined name.
 */
function quarantinedNames(fileSystem: FakeFileSystem): string[] {
  return fileSystem.names().filter((name) => QUARANTINED.test(name));
}

/**
 * Parses the stored file.
 * @param fileSystem - Filesystem holding the file.
 * @returns The parsed contents.
 */
function storedJson(fileSystem: FakeFileSystem): { entries: unknown[] } {
  return JSON.parse(fileSystem.contentsOf(AUDIT_PATH)) as { entries: unknown[] };
}

describe('AuditLogService on the secure store', () => {
  it('writes the log owner-only', () => {
    const { log, fileSystem } = makeLog();
    log.record(fakeImportSummary());
    expect(fileSystem.modeOf(AUDIT_PATH)).toBe(0o600);
  });

  it('writes the runs as the only record', () => {
    const { log, fileSystem } = makeLog();
    log.record(fakeImportSummary());
    const stored = storedJson(fileSystem);
    expect(Object.keys(stored)).toEqual(['entries']);
    expect(stored.entries).toHaveLength(1);
  });

  it('reads a list an older release wrote', () => {
    const { log: writer, fileSystem } = makeLog();
    writer.record(fakeImportSummary({ totalTransactions: 4 }));
    const legacy = JSON.stringify(storedJson(fileSystem).entries);
    const { log } = makeLog(legacy);
    const recent = log.getRecent(1);
    expect(recent.success && recent.data[0].totalTransactions).toBe(4);
  });

  it('writes an older list back as the entries record, without moving it aside', () => {
    const { log, fileSystem } = makeLog(JSON.stringify(UNREADABLE_RUNS));
    log.record(fakeImportSummary());
    expect(storedJson(fileSystem).entries.slice(0, 2)).toEqual(UNREADABLE_RUNS);
    expect(quarantinedNames(fileSystem)).toEqual([]);
  });

  it.each([
    ['text that is not JSON', 'not-json'],
    ['a root that is neither a list nor an object', JSON.stringify('x')],
    ['no entries record', JSON.stringify({})],
    ['an entries record that is not a list', JSON.stringify({ entries: 'x' })],
    ['a record besides the entries', JSON.stringify({ entries: [], extra: 1 })],
  ])('moves aside a file holding %s on the next record', (_label, contents) => {
    const { log, fileSystem } = makeLog(contents);
    expect(log.record(fakeImportSummary()).success).toBe(true);
    expect(quarantinedNames(fileSystem)).toHaveLength(1);
    expect(storedJson(fileSystem).entries).toHaveLength(1);
  });

  it('never moves aside a file for the unreadable runs it keeps', () => {
    const { log, fileSystem } = makeLog(JSON.stringify({ entries: UNREADABLE_RUNS }));
    log.record(fakeImportSummary());
    log.record(fakeImportSummary());
    expect(quarantinedNames(fileSystem)).toEqual([]);
    expect(storedJson(fileSystem).entries.slice(0, 2)).toEqual(UNREADABLE_RUNS);
  });

  it('moves aside a file that held a top-level __proto__ key, keeping its runs', () => {
    const contents = `{"__proto__":{"totalBanks":1},"entries":${JSON.stringify(UNREADABLE_RUNS)}}`;
    const { log, fileSystem } = makeLog(contents);
    expect(log.record(fakeImportSummary()).success).toBe(true);
    expect(quarantinedNames(fileSystem)).toHaveLength(1);
    expect(storedJson(fileSystem).entries.slice(0, 2)).toEqual(UNREADABLE_RUNS);
  });

  it('saves onto no file without looking for one to move aside', () => {
    const { log, fileSystem } = makeLog();
    log.record(fakeImportSummary());
    expect(fileSystem.calls.filter((call) => call === 'openForRead')).toHaveLength(1);
  });

  it('keeps the old file and fails when the new one cannot be staged', () => {
    const { log, fileSystem } = makeLog(JSON.stringify({ entries: [] }));
    fileSystem.forcedFailures.set('createExclusive', 'ENOSPC');
    const result = log.record(fakeImportSummary());
    expect(!result.success && result.message).toBe('audit write failed');
    expect(storedJson(fileSystem)).toEqual({ entries: [] });
  });

  it('fails without writing when the current file cannot be read', () => {
    const { log, fileSystem } = makeLog(JSON.stringify({ entries: [] }));
    fileSystem.forcedFailures.set('openForRead', 'EACCES');
    const result = log.record(fakeImportSummary());
    expect(!result.success && result.message).toBe('audit write failed');
    expect(fileSystem.stagedPaths).toEqual([]);
  });

  it('reads no runs when the file cannot be read', () => {
    const { log, fileSystem } = makeLog(JSON.stringify({ entries: [] }));
    fileSystem.forcedFailures.set('openForRead', 'EACCES');
    const recent = log.getRecent(5);
    expect(recent.success && recent.data).toEqual([]);
  });

  it('sweeps a staged file an earlier run left behind', () => {
    const { log, fileSystem } = makeLog();
    const staged = seedStaleStaged(fileSystem, AUDIT_PATH);
    const swept = log.sweepStagedLeftovers();
    expect(swept.success && swept.data.removedCount).toBe(1);
    expect(fileSystem.hasEntry(staged)).toBe(false);
  });
});
