/**
 * How {@link OtpSettingsStore} keeps its file safe on the shared volume.
 *
 * <p>The store sits on {@link SecureJsonStore}: the file is owner-only, a write
 * never leaves a half-written file, and a file that cannot be trusted as a
 * whole is moved aside rather than silently overwritten, so the operator can
 * still see what was there.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import StorageError from '../../src/Errors/StorageError.js';
import OtpSettingsStore from '../../src/Services/TwoFactor/OtpSettingsStore.js';
import FakeFileSystem from '../storage/FakeFileSystem.js';
import seedStaleStaged from '../storage/StaleStaging.js';

const mockLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('../../src/Logger/Index.js', () => ({
  getLogger: (): typeof mockLogger => mockLogger,
}));

/** Path every case reads and writes. */
const SETTINGS_PATH = '/data/otp-settings.json';

/** Owner-only permissions. */
const OWNER_ONLY = 0o600;

/** A predecessor moved aside by a quarantining commit. */
const QUARANTINED = /^\/data\/otp-settings\.json\.quarantined-/;

/**
 * Builds a store over a fresh in-memory filesystem, optionally seeding the file.
 * @param contents - File contents to seed, or undefined for no file.
 * @returns The store under test and the filesystem behind it.
 */
function makeStore(contents?: string): { store: OtpSettingsStore; fileSystem: FakeFileSystem } {
  const fileSystem = new FakeFileSystem();
  if (contents !== undefined) fileSystem.seedFile(SETTINGS_PATH, contents, 0o644);
  const store = new OtpSettingsStore(fileSystem, SETTINGS_PATH);
  return { store, fileSystem };
}

/**
 * Lists the quarantined predecessors on the filesystem.
 * @param fileSystem - Filesystem to inspect.
 * @returns Every quarantined name.
 */
function quarantinedNames(fileSystem: FakeFileSystem): string[] {
  return fileSystem.names().filter((name) => QUARANTINED.test(name));
}

describe('OtpSettingsStore on the secure store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes the settings owner-only', () => {
    const { store, fileSystem } = makeStore();
    store.set('app');
    expect(fileSystem.modeOf(SETTINGS_PATH)).toBe(OWNER_ONLY);
  });

  it('writes the channel as the only record', () => {
    const { store, fileSystem } = makeStore();
    store.set('app');
    expect(JSON.parse(fileSystem.contentsOf(SETTINGS_PATH))).toEqual({ channel: 'app' });
  });

  it('reads a valid channel back through the filesystem it was given', () => {
    const { store } = makeStore(JSON.stringify({ channel: 'app' }));
    expect(store.get()).toEqual({ channel: 'app' });
  });

  it.each([
    ['text that is not JSON', 'not-json'],
    ['a root that is not an object', JSON.stringify('app')],
    ['an unknown channel', JSON.stringify({ channel: 'sms' })],
    ['no channel', JSON.stringify({})],
    ['a record besides the channel', JSON.stringify({ channel: 'app', extra: 1 })],
  ])('moves aside a file holding %s on the next write', (_label, contents) => {
    const { store, fileSystem } = makeStore(contents);
    store.set('telegram');
    expect(quarantinedNames(fileSystem)).toHaveLength(1);
    expect(JSON.parse(fileSystem.contentsOf(SETTINGS_PATH))).toEqual({ channel: 'telegram' });
  });

  it.each(['app', 'telegram'] as const)('overwrites an intact %s file without moving it aside', (channel) => {
    const { store, fileSystem } = makeStore(JSON.stringify({ channel }));
    store.set(channel === 'app' ? 'telegram' : 'app');
    expect(quarantinedNames(fileSystem)).toEqual([]);
  });

  it('saves onto no file without looking for one to move aside', () => {
    const { store, fileSystem } = makeStore();
    store.set('app');
    expect(fileSystem.calls.filter((call) => call === 'openForRead')).toHaveLength(1);
  });

  it('keeps a readable channel from a file with an extra record', () => {
    const { store } = makeStore(JSON.stringify({ channel: 'app', extra: 1 }));
    expect(store.get()).toEqual({ channel: 'app' });
  });

  it('keeps the old file and throws when the new one cannot be staged', () => {
    const { store, fileSystem } = makeStore(JSON.stringify({ channel: 'app' }));
    fileSystem.forcedFailures.set('createExclusive', 'ENOSPC');
    expect(() => {
      store.set('telegram');
    }).toThrow(StorageError);
    expect(JSON.parse(fileSystem.contentsOf(SETTINGS_PATH))).toEqual({ channel: 'app' });
  });

  it('throws without writing when the current file cannot be read', () => {
    const { store, fileSystem } = makeStore(JSON.stringify({ channel: 'app' }));
    fileSystem.forcedFailures.set('openForRead', 'EACCES');
    expect(() => {
      store.set('telegram');
    }).toThrow(/OTP settings/);
    expect(fileSystem.stagedPaths).toEqual([]);
  });

  it('defaults to telegram and warns when the file cannot be read', () => {
    const { store, fileSystem } = makeStore(JSON.stringify({ channel: 'app' }));
    fileSystem.forcedFailures.set('openForRead', 'EACCES');
    expect(store.get()).toEqual({ channel: 'telegram' });
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('defaulting to telegram'));
  });

  it('defaults to telegram and warns when the file is damaged', () => {
    const { store } = makeStore('not-json');
    expect(store.get()).toEqual({ channel: 'telegram' });
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('defaulting to telegram'));
  });

  it('reads no file and warns about nothing when none exists', () => {
    const { store } = makeStore();
    expect(store.get()).toEqual({ channel: 'telegram' });
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('sweeps a staged file an earlier run left behind', () => {
    const { store, fileSystem } = makeStore();
    const staged = seedStaleStaged(fileSystem, SETTINGS_PATH);
    const swept = store.sweepStagedLeftovers();
    expect(swept.success && swept.data.removedCount).toBe(1);
    expect(fileSystem.hasEntry(staged)).toBe(false);
  });
});
