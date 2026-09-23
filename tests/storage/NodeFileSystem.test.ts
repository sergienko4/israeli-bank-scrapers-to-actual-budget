/**
 * Runs the shared {@link IFileSystem} contract against the real adapter, on a
 * real temporary volume, plus the syscall-fidelity cases an in-memory double
 * cannot prove.
 */

import { execFileSync } from 'node:child_process';
import {
  chmodSync, lstatSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import createNodeFileSystem, { READ_FLAGS } from '../../src/Storage/NodeFileSystem.js';
import { describeFileSystemContract, type IContractWorld } from './FileSystemContract.js';

/** Windows has neither `mkfifo` nor the link semantics these cases assert. */
const IS_WINDOWS = process.platform === 'win32';

const directories: string[] = [];

/**
 * Builds a world backed by a fresh temporary directory.
 * @returns A world whose names resolve inside that directory.
 */
function makeRealWorld(): IContractWorld {
  const dir = mkdtempSync(join(tmpdir(), 'fs-contract-'));
  directories.push(dir);
  return {
    path: (name) => join(dir, name),
    directory: () => dir,
    writeFile: (name, contents, mode) => {
      writeFileSync(join(dir, name), contents, { encoding: 'utf8', mode });
      chmodSync(join(dir, name), mode);
    },
    makeSymlink: (name, targetName) => symlinkSync(join(dir, targetName), join(dir, name)),
    makeDir: (name) => mkdirSync(join(dir, name)),
    makeHardLink: (existingName, newName) => linkSync(join(dir, existingName), join(dir, newName)),
    modeOf: (name) => lstatSync(join(dir, name)).mode,
    hasEntry: (name) => {
      try {
        lstatSync(join(dir, name));
        return true;
      } catch {
        return false;
      }
    },
    contentsOf: (name) => readFileSync(join(dir, name), 'utf8'),
  };
}

afterEach(() => {
  while (directories.length > 0) {
    const dir = directories.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describeFileSystemContract('NodeFileSystem', () => ({
  fileSystem: createNodeFileSystem(),
  world: makeRealWorld(),
}));

describe('NodeFileSystem syscall fidelity', () => {
  it.skipIf(IS_WINDOWS)('threat 5: opens a FIFO with flags that cannot stall the process', () => {
    const world = makeRealWorld();
    const fifo = world.path('store.json');
    execFileSync('mkfifo', [fifo]);
    // The adapter's own flags are handed to a child, so removing O_NONBLOCK
    // fails this test by timing out instead of hanging the whole suite.
    const script = 'const fs = require("node:fs");'
      + 'fs.closeSync(fs.openSync(process.env.TARGET, Number(process.env.FLAGS)));'
      + 'console.log("returned");';
    const output = execFileSync(process.execPath, ['-e', script], {
      env: { ...process.env, TARGET: fifo, FLAGS: String(READ_FLAGS) },
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(output.trim()).toBe('returned');
  });

  it.skipIf(IS_WINDOWS)('threat 5: never reports a FIFO as a regular file', () => {
    const world = makeRealWorld();
    execFileSync('mkfifo', [world.path('store.json')]);
    const fileSystem = createNodeFileSystem();
    const opened = fileSystem.openForRead(world.path('store.json'));
    if (!opened.success) throw new Error(`expected the FIFO to open: ${opened.message}`);
    expect(opened.data.isRegularFile).toBe(false);
    fileSystem.close(opened.data);
  });

  it.skipIf(IS_WINDOWS)('threat 6: leaves a hard-linked victim readable exactly as it was', () => {
    const world = makeRealWorld();
    world.writeFile('victim.txt', 'not ours', 0o644);
    world.makeHardLink('victim.txt', 'store.json');
    const fileSystem = createNodeFileSystem();
    const opened = fileSystem.openForRead(world.path('store.json'));
    if (!opened.success) throw new Error('expected the open to succeed');
    fileSystem.restrictToOwner(opened.data);
    fileSystem.close(opened.data);
    expect(lstatSync(world.path('victim.txt')).mode & 0o777).toBe(0o644);
  });

  it('reports ENOTDIR when a parent component is a regular file', () => {
    const world = makeRealWorld();
    world.writeFile('notadir', 'x', 0o600);
    const opened = createNodeFileSystem().openForRead(join(world.path('notadir'), 'store.json'));
    if (opened.success) throw new Error('expected the open to fail');
    expect(opened.status).toBe('ENOTDIR');
  });

  it('never puts the payload into a failure message', () => {
    const world = makeRealWorld();
    world.writeFile('staged.tmp', 'occupied', 0o600);
    const created = createNodeFileSystem().createExclusive(world.path('staged.tmp'), 'secret-token');
    if (created.success) throw new Error('expected the create to fail');
    expect(created.message).not.toContain('secret-token');
  });

  it('threat 19: refuses a file that is not valid UTF-8 instead of altering it', () => {
    // Adapter-only: the fake holds JS strings and cannot represent bad bytes.
    const world = makeRealWorld();
    const malformed = Buffer.from([0x7b, 0x22, 0x74, 0x22, 0x3a, 0x22, 0x61, 0xff, 0x62, 0x22, 0x7d]);
    writeFileSync(world.path('store.json'), malformed, { mode: 0o600 });
    const fileSystem = createNodeFileSystem();
    const opened = fileSystem.openForRead(world.path('store.json'));
    if (!opened.success) throw new Error('expected the open to succeed');
    const contents = fileSystem.readAll(opened.data, 1024);
    fileSystem.close(opened.data);
    if (contents.success) throw new Error('expected the read to reject malformed UTF-8');
    expect(contents.status).toBe('EILSEQ');
  });

  it('threat 19: still reads multi-byte UTF-8 that happens to be valid', () => {
    const world = makeRealWorld();
    world.writeFile('store.json', '{"t":"\u05e9\u05dc\u05d5\u05dd"}', 0o600);
    const fileSystem = createNodeFileSystem();
    const opened = fileSystem.openForRead(world.path('store.json'));
    if (!opened.success) throw new Error('expected the open to succeed');
    const contents = fileSystem.readAll(opened.data, 1024);
    fileSystem.close(opened.data);
    expect(contents.success && contents.data).toBe('{"t":"\u05e9\u05dc\u05d5\u05dd"}');
  });
});
