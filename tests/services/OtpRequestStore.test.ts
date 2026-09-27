/**
 * {@link OtpRequestStore} on a real disk, as the portal and the importer use it:
 * two store instances, one per process, over one directory.
 *
 * <p>The in-memory suite proves the protocol. This one proves the names line up
 * with a real directory listing, the files really are owner-only, and the
 * exclusive publish really refuses a taken name.
 */

import { randomUUID } from 'node:crypto';
import {
  linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import OtpRequestStore from '../../src/Services/TwoFactor/OtpRequestStore.js';
import createNodeFileSystem from '../../src/Storage/NodeFileSystem.js';

/** The code the user submits. */
const CODE = '123456';

/** Windows needs extra rights to make a symlink, so those cases skip there. */
const IS_WINDOWS = process.platform === 'win32';

let dir: string;
let importer: OtpRequestStore;
let portal: OtpRequestStore;

/**
 * Reads every file in the directory as text.
 * @returns The contents of each file.
 */
function allContents(): string[] {
  return readdirSync(dir).map((name) => readFileSync(join(dir, name), 'utf8'));
}

/**
 * Reads a file's permission bits.
 * @param name - File name inside the directory.
 * @returns The mode's permission bits.
 */
function modeOf(name: string): number {
  return statSync(join(dir, name)).mode & 0o777;
}

describe('OtpRequestStore on a real filesystem', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'otp-'));
    importer = new OtpRequestStore(createNodeFileSystem(), join(dir, 'otp-requests.json'));
    portal = new OtpRequestStore(createNodeFileSystem(), join(dir, 'otp-requests.json'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists no pending requests in an empty directory', () => {
    expect(portal.pending()).toEqual([]);
  });

  it('lists no pending requests when the directory does not exist', () => {
    const missing = new OtpRequestStore(createNodeFileSystem(), join(dir, 'gone', 'otp-requests.json'));
    expect(missing.pending()).toEqual([]);
  });

  it('carries a code from the portal to the importer, leaving it nowhere on disk', () => {
    const created = importer.create('leumi', 60_000);
    expect(modeOf(`otp-requests.${created.id}.json`)).toBe(0o600);
    expect(portal.pending().map((request) => request.bankId)).toEqual(['leumi']);
    expect(portal.submit(created.id, CODE)).toBe(true);
    expect(modeOf(`otp-requests.${created.id}.answer.json`)).toBe(0o600);
    expect(portal.pending()).toEqual([]);
    expect(importer.poll(created)).toEqual({ kind: 'code', code: CODE });
    expect(readdirSync(dir)).toEqual([`otp-requests.${created.id}.answer.json`]);
    expect(allContents().filter((text) => text.includes(CODE))).toEqual([]);
    expect(portal.submit(created.id, '654321')).toBe(false);
  });

  it('refuses a code once the importer has recorded the expiry', () => {
    const created = importer.create('leumi', 60_000, 1_000);
    expect(importer.poll(created, 61_000)).toEqual({ kind: 'expired' });
    writeFileSync(join(dir, `otp-requests.${created.id}.json`), JSON.stringify(created), { mode: 0o600 });
    expect(portal.submit(created.id, CODE, 2_000)).toBe(false);
    expect(allContents().filter((text) => text.includes(CODE))).toEqual([]);
  });

  it('hands the importer a code the portal published just before the deadline', () => {
    const created = importer.create('leumi', 60_000, 1_000);
    expect(portal.submit(created.id, CODE, 60_999)).toBe(true);
    expect(importer.poll(created, 61_000)).toEqual({ kind: 'code', code: CODE });
  });

  it('hands over a code whose answer still has its staging name at the deadline', () => {
    const created = importer.create('leumi', 60_000, 1_000);
    expect(portal.submit(created.id, CODE, 2_000)).toBe(true);
    const answer = join(dir, `otp-requests.${created.id}.answer.json`);
    linkSync(answer, `${answer}.${randomUUID()}.tmp`);
    expect(importer.poll(created, 61_000)).toEqual({ kind: 'code', code: CODE });
  });

  it('leaves the code nowhere on disk when the answer\'s staging name outlived its publish', () => {
    const created = importer.create('leumi', 60_000);
    expect(portal.submit(created.id, CODE)).toBe(true);
    const answer = join(dir, `otp-requests.${created.id}.answer.json`);
    linkSync(answer, `${answer}.${randomUUID()}.tmp`);
    expect(importer.poll(created)).toEqual({ kind: 'code', code: CODE });
    expect(readdirSync(dir)).toEqual([`otp-requests.${created.id}.answer.json`]);
    expect(allContents().filter((text) => text.includes(CODE))).toEqual([]);
  });

  it('accepts a code for a request that still has its staging name', () => {
    const created = importer.create('leumi', 60_000, 1_000);
    const request = join(dir, `otp-requests.${created.id}.json`);
    linkSync(request, `${request}.${randomUUID()}.tmp`);
    expect(portal.submit(created.id, CODE, 2_000)).toBe(true);
  });

  it.skipIf(IS_WINDOWS)('writes requests where it lists them, through a symlink and ..', () => {
    mkdirSync(join(dir, 'real', 'sub'), { recursive: true });
    symlinkSync(join(dir, 'real', 'sub'), join(dir, 'link'));
    const basePath = `${dir}/link/../otp-requests.json`;
    const linkedImporter = new OtpRequestStore(createNodeFileSystem(), basePath);
    const linkedPortal = new OtpRequestStore(createNodeFileSystem(), basePath);
    const created = linkedImporter.create('leumi', 60_000);
    expect(linkedPortal.pending().map((request) => request.id)).toEqual([created.id]);
    expect(linkedPortal.submit(created.id, CODE)).toBe(true);
    expect(linkedImporter.poll(created)).toEqual({ kind: 'code', code: CODE });
    expect(readdirSync(join(dir, 'real')).sort()).toEqual([
      `otp-requests.${created.id}.answer.json`, 'sub',
    ]);
    expect(readdirSync(dir).sort()).toEqual(['link', 'real']);
  });

  it('ignores the combined file an older release wrote', () => {
    const legacy = { requests: [{ id: 'old', bankId: 'leumi', createdAt: 1, deadline: 9e15 }] };
    writeFileSync(join(dir, 'otp-requests.json'), JSON.stringify(legacy), { mode: 0o600 });
    expect(portal.pending()).toEqual([]);
  });
});
