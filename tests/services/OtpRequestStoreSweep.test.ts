/**
 * What the OTP sweep removes when a process starts, and what it leaves.
 *
 * <p>A request or an answer goes an hour after its own deadline, so an orphan
 * code leaves the disk too. One that cannot be read goes an hour after it was
 * last written: files are published whole, so an unreadable one is damage,
 * not a write in progress. The combined file an older release wrote, and any
 * staged copy, go an hour after they were last written. Nothing else in the
 * directory is touched.
 */

import { describe, expect, it } from 'vitest';

import OtpRequestStore from '../../src/Services/TwoFactor/OtpRequestStore.js';
import { STALE_STAGING_AGE_MS } from '../../src/Storage/StagingSweep.js';
import FakeFileSystem from '../storage/FakeFileSystem.js';

/** The configured `OTP_REQUESTS_PATH` every name derives from. */
const BASE_PATH = '/data/otp-requests.json';

/** Two UUIDs to name files under. */
const FIRST_ID = '0f0e0d0c-0b0a-4908-8706-050403020100';
const SECOND_ID = '1f1e1d1c-1b1a-4918-9716-151413121110';

/** A staging token of the shape every store stages under. */
const STAGED_TOKEN = '3f1a7c2e-9b4d-4e11-8a6f-2c5d7e9b1a30';

/** A moment more than an hour ago, and one less than an hour ago. */
const PAST_GRACE = (): number => Date.now() - STALE_STAGING_AGE_MS - 60_000;
const WITHIN_GRACE = (): number => Date.now() - STALE_STAGING_AGE_MS + 60_000;

/**
 * Builds a store over a fresh in-memory filesystem holding the data directory.
 * @returns The store under test and the filesystem behind it.
 */
function makeStore(): { store: OtpRequestStore; fileSystem: FakeFileSystem } {
  const fileSystem = new FakeFileSystem();
  fileSystem.seedDirectory('/data');
  const store = new OtpRequestStore(fileSystem, BASE_PATH);
  return { store, fileSystem };
}

/**
 * Seeds a file last written at a given moment.
 * @param fileSystem - Filesystem to seed.
 * @param name - Path of the file.
 * @param contents - What it holds.
 * @param writtenAt - Its modification time, epoch ms.
 */
function seedAged(fileSystem: FakeFileSystem, name: string, contents: string, writtenAt: number): void {
  fileSystem.seedFile(name, contents, 0o600);
  fileSystem.setModifiedAt(name, writtenAt);
}

/**
 * Sweeps and returns how many files went.
 * @param store - Store to sweep.
 * @returns The removed count, or -1 when the sweep failed.
 */
function sweptCount(store: OtpRequestStore): number {
  const swept = store.sweepStagedLeftovers();
  return swept.success ? swept.data.removedCount : -1;
}

describe('OtpRequestStore sweep', () => {
  it.each([
    ['a request', `/data/otp-requests.${FIRST_ID}.json`],
    ['an answer', `/data/otp-requests.${FIRST_ID}.answer.json`],
  ])('removes %s an hour past its own deadline, however recently written', (_label, name) => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(name, JSON.stringify({ id: FIRST_ID, requestId: FIRST_ID, deadline: PAST_GRACE() }), 0o600);
    expect(sweptCount(store)).toBe(1);
    expect(fileSystem.hasEntry(name)).toBe(false);
  });

  it.each([
    ['a request', `/data/otp-requests.${FIRST_ID}.json`],
    ['an answer', `/data/otp-requests.${FIRST_ID}.answer.json`],
  ])('keeps %s within an hour of its deadline, however long ago written', (_label, name) => {
    const { store, fileSystem } = makeStore();
    seedAged(fileSystem, name, JSON.stringify({ requestId: FIRST_ID, deadline: WITHIN_GRACE() }), 0);
    expect(sweptCount(store)).toBe(0);
    expect(fileSystem.hasEntry(name)).toBe(true);
  });

  it.each([
    ['text that is not JSON', 'not-json'],
    ['no deadline', JSON.stringify({ requestId: FIRST_ID })],
    ['a deadline that is not a number', JSON.stringify({ deadline: '0' })],
    ['a deadline JSON reads as infinite', '{"deadline":1e999}'],
    ['a root that is not an object', '7'],
    ['a deadline beside a __proto__ key', '{"deadline":0,"__proto__":{}}'],
  ])('ages a file holding %s by when it was last written', (_label, contents) => {
    const { store, fileSystem } = makeStore();
    seedAged(fileSystem, `/data/otp-requests.${FIRST_ID}.answer.json`, contents, PAST_GRACE());
    seedAged(fileSystem, `/data/otp-requests.${SECOND_ID}.answer.json`, contents, WITHIN_GRACE());
    expect(sweptCount(store)).toBe(1);
    expect(fileSystem.hasEntry(`/data/otp-requests.${SECOND_ID}.answer.json`)).toBe(true);
  });

  it('ages a file it cannot read by when it was last written', () => {
    const { store, fileSystem } = makeStore();
    seedAged(fileSystem, `/data/otp-requests.${FIRST_ID}.json`, '{"deadline":0}', PAST_GRACE());
    fileSystem.forcedFailures.set('readAll', 'EIO');
    seedAged(fileSystem, `/data/otp-requests.${SECOND_ID}.json`, '{"deadline":0}', WITHIN_GRACE());
    expect(sweptCount(store)).toBe(1);
    expect(fileSystem.hasEntry(`/data/otp-requests.${SECOND_ID}.json`)).toBe(true);
  });

  it('removes the combined file an older release wrote an hour after its last write', () => {
    const { store, fileSystem } = makeStore();
    seedAged(fileSystem, BASE_PATH, JSON.stringify({ requests: [{ code: '123456' }] }), PAST_GRACE());
    expect(sweptCount(store)).toBe(1);
    expect(fileSystem.hasEntry(BASE_PATH)).toBe(false);
  });

  it('keeps the combined file within an hour of its last write', () => {
    const { store, fileSystem } = makeStore();
    seedAged(fileSystem, BASE_PATH, JSON.stringify({ requests: [] }), WITHIN_GRACE());
    expect(sweptCount(store)).toBe(0);
  });

  it.each([
    ['a request', `/data/otp-requests.${FIRST_ID}.json`],
    ['an answer', `/data/otp-requests.${FIRST_ID}.answer.json`],
    ['the combined file', BASE_PATH],
  ])('removes a staged copy of %s an hour after its last write, keeping a fresh one', (_label, name) => {
    const { store, fileSystem } = makeStore();
    seedAged(fileSystem, `${name}.${STAGED_TOKEN}.tmp`, '{"deadline":9e15}', PAST_GRACE());
    seedAged(fileSystem, `${name}.${FIRST_ID}.tmp`, '{}', WITHIN_GRACE());
    expect(sweptCount(store)).toBe(1);
    expect(fileSystem.hasEntry(`${name}.${FIRST_ID}.tmp`)).toBe(true);
  });

  it('leaves every other name alone, however old', () => {
    const { store, fileSystem } = makeStore();
    const others = [
      '/data/other.json', '/data/otp-requests.not-a-uuid.json', `/data/otp-requests.${FIRST_ID.toUpperCase()}.json`,
      `/data/otp-requests.${FIRST_ID}.jsox`, `/data/otp-requests.${FIRST_ID}.answer.jsox`,
      `/data/abc-requests.${FIRST_ID}.json`, `/data/abc-requests.${FIRST_ID}.answer.json`,
      `/data/otp-requests.${FIRST_ID}.json.bak`, `/data/otp-requests.${FIRST_ID}.answer.json.old.tmp`,
      '/data/otp-requests.json.tmp', `/data/other.json.${STAGED_TOKEN}.tmp`,
      `/data/otp-requests.json.quarantined-2020-01-01T00-00-00-000Z-${STAGED_TOKEN}`,
    ];
    for (const name of others) seedAged(fileSystem, name, '{"deadline":0}', 0);
    expect(sweptCount(store)).toBe(0);
    expect(others.filter((name) => !fileSystem.hasEntry(name))).toEqual([]);
  });

  it('leaves a symlink or a directory under an OTP name alone', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile('/elsewhere.json', '{"deadline":0}', 0o600);
    fileSystem.seedSymlink(`/data/otp-requests.${FIRST_ID}.json`, '/elsewhere.json');
    fileSystem.seedDirectory(`/data/otp-requests.${SECOND_ID}.answer.json`);
    expect(sweptCount(store)).toBe(0);
    expect(fileSystem.hasEntry('/elsewhere.json')).toBe(true);
  });

  it('reports what it removed, naming no contents', () => {
    const { store, fileSystem } = makeStore();
    seedAged(fileSystem, BASE_PATH, '{"requests":[{"code":"123456"}]}', PAST_GRACE());
    seedAged(fileSystem, `/data/otp-requests.${FIRST_ID}.answer.json`, '{"code":"123456","deadline":0}', 0);
    const swept = store.sweepStagedLeftovers();
    expect(swept.success && swept.data).toEqual({ removedCount: 2, summary: 'Removed 2 expired or abandoned OTP files' });
  });

  it('reports a directory it cannot list, with its errno', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.forcedFailures.set('listNames', 'ENOENT');
    const swept = store.sweepStagedLeftovers();
    expect(swept.success ? 'swept' : swept.status).toBe('ENOENT');
  });

  it('keeps a live request and its fresh answer', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', 60_000);
    store.submit(created.id, '123456');
    expect(sweptCount(store)).toBe(0);
    expect(fileSystem.names()).toHaveLength(3);
  });
});
