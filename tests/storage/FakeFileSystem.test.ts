/**
 * Runs the shared {@link IFileSystem} contract against the in-memory double.
 *
 * <p>This file is the reason the double can be trusted. Every expectation
 * here is the same one the real adapter must satisfy, so a fake that quietly
 * stops behaving like a filesystem fails the build rather than silently
 * validating the policy tests built on top of it.
 */

import { describe, expect, it } from 'vitest';

import FakeFileSystem from './FakeFileSystem.js';
import { describeFileSystemContract, type IContractWorld } from './FileSystemContract.js';

/** Directory every name in the fake world resolves into. */
const FAKE_DIRECTORY = '/fake';

/**
 * Builds a world backed by a fresh in-memory filesystem.
 * @param fake - The double whose state the world arranges.
 * @returns A world that reads and writes that double's entries.
 */
function makeFakeWorld(fake: FakeFileSystem): IContractWorld {
  const at = (name: string): string => `${FAKE_DIRECTORY}/${name}`;
  fake.seedDirectory(FAKE_DIRECTORY);
  return {
    path: at,
    directory: () => FAKE_DIRECTORY,
    writeFile: (name, contents, mode) => fake.seedFile(at(name), contents, mode),
    makeSymlink: (name, targetName) => fake.seedSymlink(at(name), at(targetName)),
    makeDir: (name) => fake.seedDirectory(at(name)),
    makeHardLink: (existingName, newName) => fake.seedHardLink(at(existingName), at(newName)),
    modeOf: (name) => fake.modeOf(at(name)),
    hasEntry: (name) => fake.hasEntry(at(name)),
    contentsOf: (name) => fake.contentsOf(at(name)),
  };
}

describeFileSystemContract('FakeFileSystem', () => {
  const fake = new FakeFileSystem();
  return { fileSystem: fake, world: makeFakeWorld(fake) };
});

describe('FakeFileSystem failure injection', () => {
  it('can force any operation to fail with a chosen errno', () => {
    const fake = new FakeFileSystem();
    fake.seedFile('store.json', '{}', 0o600);
    fake.forcedFailures.set('openForRead', 'EACCES');
    const opened = fake.openForRead('store.json');
    if (opened.success) throw new Error('expected the forced failure');
    expect(opened.status).toBe('EACCES');
  });

  it('simulates a full disk on create, which no real volume can be made to do', () => {
    const fake = new FakeFileSystem();
    fake.forcedFailures.set('createExclusive', 'ENOSPC');
    const created = fake.createExclusive('staged.tmp', '{}');
    if (created.success) throw new Error('expected the forced failure');
    expect(created.status).toBe('ENOSPC');
    expect(fake.hasEntry('staged.tmp')).toBe(false);
  });
});
