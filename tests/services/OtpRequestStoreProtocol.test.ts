/**
 * {@link OtpRequestStore}: one file per request, one answer per request.
 *
 * <p>The importer publishes each request as its own file and never rewrites
 * it. The answer is published exclusively by whichever side is first: the
 * portal with the user's code, or the importer with an expiry at the
 * deadline. A used code is replaced by a tombstone, so the code leaves the
 * disk but the answer's name stays taken.
 */

import { describe, expect, it } from 'vitest';

import StorageError from '../../src/Errors/StorageError.js';
import OtpRequestStore, { type IOtpRequest } from '../../src/Services/TwoFactor/OtpRequestStore.js';
import FakeFileSystem from '../storage/FakeFileSystem.js';

/** The configured `OTP_REQUESTS_PATH` every name derives from. */
const BASE_PATH = '/data/otp-requests.json';

/** Clock every case starts at, epoch ms. */
const NOW = 1_000_000;

/** How long every request lives, ms. */
const TTL = 60_000;

/** The code the user submits. */
const CODE = '123456';

/** A UUID no request was created under. */
const UNKNOWN_ID = '0f0e0d0c-0b0a-4908-8706-050403020100';

/** The random token in a staged copy's name. */
const STAGE_TOKEN = '11111111-2222-4333-8444-555555555555';

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
 * Names a request's own file.
 * @param id - The request id.
 * @returns The request file path.
 */
function requestPath(id: string): string {
  return `/data/otp-requests.${id}.json`;
}

/**
 * Names a request's answer file.
 * @param id - The request id.
 * @returns The answer file path.
 */
function answerPath(id: string): string {
  return `/data/otp-requests.${id}.answer.json`;
}

/**
 * Seeds a staged copy of a request's answer holding the user's code, as a
 * publish whose stage could not be unlinked leaves one.
 * @param fileSystem - Filesystem to seed.
 * @param id - The request id.
 * @returns The staged copy's path.
 */
function seedAnswerStage(fileSystem: FakeFileSystem, id: string): string {
  const stage = `${answerPath(id)}.${STAGE_TOKEN}.tmp`;
  const answer = JSON.stringify({ requestId: id, deadline: NOW + TTL, code: CODE });
  fileSystem.seedFile(stage, answer, 0o600);
  return stage;
}

/**
 * Parses a request's answer file.
 * @param fileSystem - Filesystem holding it.
 * @param id - The request id.
 * @returns The parsed answer.
 */
function answerOf(fileSystem: FakeFileSystem, id: string): unknown {
  return JSON.parse(fileSystem.contentsOf(answerPath(id)));
}

/**
 * Lists every name inside the data directory.
 * @param fileSystem - Filesystem to inspect.
 * @returns The file names.
 */
function filesIn(fileSystem: FakeFileSystem): string[] {
  return fileSystem.names().filter((name) => name !== '/data');
}

/**
 * Lists the ids of the pending requests.
 * @param store - Store to ask.
 * @param now - The time to ask at.
 * @returns The ids, in the order returned.
 */
function pendingIds(store: OtpRequestStore, now: number): string[] {
  return store.pending(now).map((request) => request.id);
}

/**
 * Seeds a request file as the importer would publish it.
 * @param fileSystem - Filesystem to seed.
 * @param request - The request to store.
 */
function seedRequest(fileSystem: FakeFileSystem, request: IOtpRequest): void {
  fileSystem.seedFile(requestPath(request.id), JSON.stringify(request), 0o600);
}

describe('OtpRequestStore: creating a request', () => {
  it('publishes each request whole as its own owner-only file', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    expect(filesIn(fileSystem)).toEqual([requestPath(created.id)]);
    expect(JSON.parse(fileSystem.contentsOf(requestPath(created.id)))).toEqual({
      id: created.id, bankId: 'leumi', createdAt: NOW, deadline: NOW + TTL,
    });
    expect(fileSystem.modeOf(requestPath(created.id))).toBe(0o600);
  });

  it('never loses one request to another', () => {
    const { store } = makeStore();
    const first = store.create('leumi', TTL, NOW);
    const second = store.create('discount', TTL, NOW + 1);
    expect(pendingIds(store, NOW + 2)).toEqual([first.id, second.id]);
  });

  it('publishes a request only to a free name, never over one', () => {
    const { store, fileSystem } = makeStore();
    store.create('leumi', TTL, NOW);
    expect(fileSystem.calls).toContain('publishExclusive');
    expect(fileSystem.calls).not.toContain('rename');
  });

  it('throws and leaves nothing when the request cannot be published', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.forcedFailures.set('publishExclusive', 'EPERM');
    expect(() => store.create('leumi', TTL, NOW)).toThrow(StorageError);
    expect(filesIn(fileSystem)).toEqual([]);
  });
});

describe('OtpRequestStore: listing pending requests', () => {
  it('lists live unanswered requests, oldest first', () => {
    const { store } = makeStore();
    const later = store.create('leumi', TTL, NOW + 10);
    const earlier = store.create('discount', TTL, NOW);
    expect(pendingIds(store, NOW + 20)).toEqual([earlier.id, later.id]);
  });

  it('hides an answered request', () => {
    const { store } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    store.submit(created.id, CODE, NOW + 1);
    expect(store.pending(NOW + 2)).toEqual([]);
  });

  it('hides a request once its deadline is reached', () => {
    const { store } = makeStore();
    store.create('leumi', TTL, NOW);
    expect(store.pending(NOW + TTL - 1)).toHaveLength(1);
    expect(store.pending(NOW + TTL)).toEqual([]);
  });

  it('hides a request whose answer name is taken, whatever the answer holds', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    fileSystem.seedFile(answerPath(created.id), 'not-json', 0o600);
    expect(store.pending(NOW + 1)).toEqual([]);
  });

  it('lists a request with its public fields only', () => {
    const { store } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    expect(store.pending(NOW + 1)).toEqual([created]);
  });

  it('reads only request files, and only well-formed ones under their own id', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    const shape = { bankId: 'x', createdAt: NOW, deadline: NOW + TTL };
    fileSystem.seedFile('/data/other.json', JSON.stringify({ id: UNKNOWN_ID, ...shape }), 0o600);
    fileSystem.seedFile('/data/otp-requests.json', JSON.stringify({ requests: [{ id: UNKNOWN_ID, ...shape }] }), 0o600);
    fileSystem.seedFile('/data/otp-requests.not-a-uuid.json', JSON.stringify({ id: 'not-a-uuid', ...shape }), 0o600);
    fileSystem.seedFile(`/data/otp-requests.${UNKNOWN_ID}.jsox`, JSON.stringify({ id: UNKNOWN_ID, ...shape }), 0o600);
    fileSystem.seedFile(`/data/abc-requests.${UNKNOWN_ID}.json`, JSON.stringify({ id: UNKNOWN_ID, ...shape }), 0o600);
    const upper = UNKNOWN_ID.toUpperCase();
    fileSystem.seedFile(requestPath(upper), JSON.stringify({ id: upper, ...shape }), 0o600);
    fileSystem.seedFile(requestPath(UNKNOWN_ID), JSON.stringify({ id: created.id, ...shape }), 0o600);
    expect(pendingIds(store, NOW + 1)).toEqual([created.id]);
  });

  it.each([
    ['text that is not JSON', 'not-json'],
    ['no bank', JSON.stringify({ id: UNKNOWN_ID, createdAt: NOW, deadline: NOW + TTL })],
    ['a deadline that is not a number', JSON.stringify({ id: UNKNOWN_ID, bankId: 'b', createdAt: NOW, deadline: 'soon' })],
    ['a creation time that is not a number', JSON.stringify({ id: UNKNOWN_ID, bankId: 'b', createdAt: 'now', deadline: NOW + TTL })],
    ['an id that is not a string', JSON.stringify({ id: 7, bankId: 'b', createdAt: NOW, deadline: NOW + TTL })],
    ['a deadline that never comes', `{"id":"${UNKNOWN_ID}","bankId":"b","createdAt":${String(NOW)},"deadline":1e999}`],
    ['a creation time that is not finite', `{"id":"${UNKNOWN_ID}","bankId":"b","createdAt":-1e999,"deadline":${String(NOW + TTL)}}`],
  ])('skips a request file holding %s', (_label, contents) => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(requestPath(UNKNOWN_ID), contents, 0o600);
    expect(store.pending(NOW + 1)).toEqual([]);
  });

  it('lists nothing when the directory cannot be read', () => {
    const { store, fileSystem } = makeStore();
    store.create('leumi', TTL, NOW);
    fileSystem.forcedFailures.set('listNames', 'EACCES');
    expect(store.pending(NOW + 1)).toEqual([]);
  });

  it('skips a request file it cannot read', () => {
    const { store, fileSystem } = makeStore();
    store.create('leumi', TTL, NOW);
    fileSystem.forcedFailures.set('openForRead', 'EACCES');
    expect(store.pending(NOW + 1)).toEqual([]);
  });

  it('hides, and refuses a code for, a request file with a field the importer never writes', () => {
    const { store, fileSystem } = makeStore();
    const fields = { id: UNKNOWN_ID, bankId: 'leumi', createdAt: NOW, deadline: NOW + TTL, role: 'admin' };
    fileSystem.seedFile(requestPath(UNKNOWN_ID), JSON.stringify(fields), 0o600);
    expect(store.pending(NOW + 1)).toEqual([]);
    expect(store.submit(UNKNOWN_ID, CODE, NOW + 1)).toBe(false);
    expect(fileSystem.hasEntry(answerPath(UNKNOWN_ID))).toBe(false);
  });

  it('hides, and refuses a code for, a request file that held a __proto__ key', () => {
    // The parser leaves the key out, so the rest looks well formed; but no
    // file this code writes holds one, so the file reads as absent.
    const { store, fileSystem } = makeStore();
    const fields = JSON.stringify({ id: UNKNOWN_ID, bankId: 'leumi', createdAt: NOW, deadline: NOW + TTL });
    fileSystem.seedFile(requestPath(UNKNOWN_ID), `${fields.slice(0, -1)},"__proto__":{}}`, 0o600);
    expect(store.pending(NOW + 1)).toEqual([]);
    expect(store.submit(UNKNOWN_ID, CODE, NOW + 1)).toBe(false);
    expect(fileSystem.hasEntry(answerPath(UNKNOWN_ID))).toBe(false);
  });
});

describe('OtpRequestStore: submitting a code', () => {
  it('publishes the code as the answer, owner-only, with the deadline', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    expect(store.submit(created.id, CODE, NOW + 1)).toBe(true);
    expect(answerOf(fileSystem, created.id)).toEqual({ requestId: created.id, deadline: NOW + TTL, code: CODE });
    expect(fileSystem.modeOf(answerPath(created.id))).toBe(0o600);
  });

  it.each([
    ['a relative path', '../otp-requests'],
    ['a short id', 'req-1'],
    ['an upper-case UUID', UNKNOWN_ID.toUpperCase()],
    ['a UUID with a path after it', `${UNKNOWN_ID}/x`],
    ['an empty id', ''],
  ])('builds no path from %s', (_label, id) => {
    const { store, fileSystem } = makeStore();
    expect(store.submit(id, CODE, NOW)).toBe(false);
    expect(fileSystem.calls).toEqual([]);
  });

  it('answers false and publishes nothing for a request that does not exist', () => {
    const { store, fileSystem } = makeStore();
    expect(store.submit(UNKNOWN_ID, CODE, NOW)).toBe(false);
    expect(fileSystem.stagedPaths).toEqual([]);
  });

  it('answers false and publishes nothing once the deadline is reached', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    expect(store.submit(created.id, CODE, NOW + TTL)).toBe(false);
    expect(fileSystem.hasEntry(answerPath(created.id))).toBe(false);
  });

  it.each([
    ['text that is not JSON', 'not-json'],
    ['no bank', JSON.stringify({ id: UNKNOWN_ID, createdAt: NOW, deadline: NOW + TTL })],
    ['a deadline that is not a number', JSON.stringify({ id: UNKNOWN_ID, bankId: 'b', createdAt: NOW, deadline: 'soon' })],
    ['another request\'s id', JSON.stringify({ id: `${UNKNOWN_ID.slice(0, -1)}1`, bankId: 'b', createdAt: NOW, deadline: NOW + TTL })],
  ])('answers false, publishing nothing, for a request file holding %s', (_label, contents) => {
    const { store, fileSystem } = makeStore();
    fileSystem.seedFile(requestPath(UNKNOWN_ID), contents, 0o600);
    expect(store.submit(UNKNOWN_ID, CODE, NOW)).toBe(false);
    expect(fileSystem.hasEntry(answerPath(UNKNOWN_ID))).toBe(false);
  });

  it('answers false when the expiry won, leaving the answer as it was', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    const expiry = JSON.stringify({ requestId: created.id, deadline: NOW + TTL, expired: true });
    fileSystem.seedFile(answerPath(created.id), expiry, 0o600);
    expect(store.submit(created.id, CODE, NOW + 1)).toBe(false);
    expect(fileSystem.contentsOf(answerPath(created.id))).toBe(expiry);
  });

  it('keeps the first code when a second one is submitted', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    store.submit(created.id, '111111', NOW + 1);
    expect(store.submit(created.id, '222222', NOW + 2)).toBe(false);
    expect(answerOf(fileSystem, created.id)).toMatchObject({ code: '111111' });
  });

  it('answers false after the code was used, even with the request back in place', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    store.submit(created.id, '111111', NOW + 1);
    store.poll(created, NOW + 2);
    seedRequest(fileSystem, created);
    expect(store.submit(created.id, '222222', NOW + 3)).toBe(false);
    expect(fileSystem.contentsOf(answerPath(created.id))).not.toContain('222222');
  });

  it('throws when the request cannot be read', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    fileSystem.forcedFailures.set('openForRead', 'EACCES');
    expect(() => store.submit(created.id, CODE, NOW + 1)).toThrow(StorageError);
  });

  it('throws, and leaves no answer or staged copy, when the answer cannot be published', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    fileSystem.forcedFailures.set('publishExclusive', 'EPERM');
    expect(() => store.submit(created.id, CODE, NOW + 1)).toThrow(StorageError);
    expect(filesIn(fileSystem)).toEqual([requestPath(created.id)]);
  });

  it('names the errno, and never the code, when the answer cannot be published', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    fileSystem.forcedFailures.set('publishExclusive', 'EPERM');
    expect(() => store.submit(created.id, CODE, NOW + 1)).toThrow(/EPERM/);
    expect(() => store.submit(created.id, CODE, NOW + 1)).not.toThrow(new RegExp(CODE));
  });
});

describe('OtpRequestStore: polling for the answer', () => {
  it('waits, writing nothing, while no answer has arrived', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    expect(store.poll(created, NOW + 1)).toEqual({ kind: 'waiting' });
    expect(fileSystem.stagedPaths).toHaveLength(1);
    expect(filesIn(fileSystem)).toEqual([requestPath(created.id)]);
  });

  it('returns the code, removes the request, and replaces the code with a tombstone', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    store.submit(created.id, CODE, NOW + 1);
    expect(store.poll(created, NOW + 2)).toEqual({ kind: 'code', code: CODE });
    expect(fileSystem.hasEntry(requestPath(created.id))).toBe(false);
    expect(answerOf(fileSystem, created.id)).toEqual({ requestId: created.id, deadline: NOW + TTL, consumed: true });
    expect(filesIn(fileSystem).filter((name) => fileSystem.contentsOf(name).includes(CODE))).toEqual([]);
  });

  it('returns a code submitted before the deadline when the importer\'s expiry comes second', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    store.submit(created.id, CODE, NOW + TTL - 1);
    expect(store.poll(created, NOW + TTL)).toEqual({ kind: 'code', code: CODE });
    expect(answerOf(fileSystem, created.id)).toMatchObject({ consumed: true });
  });

  it('records the expiry at the deadline, and a later submit answers false', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    expect(store.poll(created, NOW + TTL)).toEqual({ kind: 'expired' });
    expect(answerOf(fileSystem, created.id)).toEqual({ requestId: created.id, deadline: NOW + TTL, expired: true });
    expect(fileSystem.hasEntry(requestPath(created.id))).toBe(false);
    seedRequest(fileSystem, created);
    expect(store.submit(created.id, CODE, NOW + 1)).toBe(false);
  });

  it('removes a staged copy of the used answer, so the code leaves the disk', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    store.submit(created.id, CODE, NOW + 1);
    const stage = seedAnswerStage(fileSystem, created.id);
    expect(store.poll(created, NOW + 2)).toEqual({ kind: 'code', code: CODE });
    expect(fileSystem.hasEntry(stage)).toBe(false);
    expect(filesIn(fileSystem).filter((name) => fileSystem.contentsOf(name).includes(CODE))).toEqual([]);
  });

  it('removes the staged copy left by a submit whose stage could not be removed', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    fileSystem.forcedFailuresOnce.set('remove', 'EBUSY');
    expect(store.submit(created.id, CODE, NOW + 1)).toBe(true);
    expect(filesIn(fileSystem).filter((name) => name.endsWith('.tmp'))).toHaveLength(1);
    expect(store.poll(created, NOW + 2)).toEqual({ kind: 'code', code: CODE });
    expect(filesIn(fileSystem).filter((name) => fileSystem.contentsOf(name).includes(CODE))).toEqual([]);
  });

  it('removes a staged copy of the answer when the request expires', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    const stage = seedAnswerStage(fileSystem, created.id);
    expect(store.poll(created, NOW + TTL)).toEqual({ kind: 'expired' });
    expect(fileSystem.hasEntry(stage)).toBe(false);
  });

  it('leaves a staged answer alone while waiting, and another request\'s after settling', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    const other = store.create('leumi', TTL, NOW);
    const ownStage = seedAnswerStage(fileSystem, created.id);
    const otherStage = seedAnswerStage(fileSystem, other.id);
    expect(store.poll(created, NOW + 1)).toEqual({ kind: 'waiting' });
    expect(fileSystem.hasEntry(ownStage)).toBe(true);
    store.submit(created.id, CODE, NOW + 1);
    expect(store.poll(created, NOW + 2)).toEqual({ kind: 'code', code: CODE });
    expect(fileSystem.hasEntry(otherStage)).toBe(true);
  });

  it.each(['listNames', 'remove'])('still hands over the code when %s fails', (operation) => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    store.submit(created.id, CODE, NOW + 1);
    seedAnswerStage(fileSystem, created.id);
    fileSystem.forcedFailures.set(operation, 'EACCES');
    expect(store.poll(created, NOW + 2)).toEqual({ kind: 'code', code: CODE });
  });

  it('hands over no code from an answer that held a __proto__ key', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    const fields = JSON.stringify({ requestId: created.id, deadline: NOW + TTL, code: CODE });
    fileSystem.seedFile(answerPath(created.id), `${fields.slice(0, -1)},"__proto__":{}}`, 0o600);
    expect(store.poll(created, NOW + 1)).toEqual({ kind: 'waiting' });
    expect(store.poll(created, NOW + TTL)).toEqual({ kind: 'expired' });
  });

  it('reports the expiry, and removes the request, when the taken answer holds no code', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    fileSystem.seedFile(answerPath(created.id), 'not-json', 0o600);
    expect(store.poll(created, NOW + TTL)).toEqual({ kind: 'expired' });
    expect(fileSystem.hasEntry(requestPath(created.id))).toBe(false);
  });

  it('keeps waiting while the answer names another request', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    const foreign = JSON.stringify({ requestId: UNKNOWN_ID, deadline: NOW + TTL, code: CODE });
    fileSystem.seedFile(answerPath(created.id), foreign, 0o600);
    expect(store.poll(created, NOW + 1)).toEqual({ kind: 'waiting' });
  });

  it('keeps waiting while the answer\'s code is not text', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    const numeric = JSON.stringify({ requestId: created.id, deadline: NOW + TTL, code: 123_456 });
    fileSystem.seedFile(answerPath(created.id), numeric, 0o600);
    expect(store.poll(created, NOW + 1)).toEqual({ kind: 'waiting' });
  });

  it.each([
    ['empty', ''],
    ['led by letters', 'ab123456'],
    ['too short', '123'],
    ['too long', '123456789'],
  ])('keeps waiting while the answer\'s code is %s', (_label, code) => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    const answer = JSON.stringify({ requestId: created.id, deadline: NOW + TTL, code });
    fileSystem.seedFile(answerPath(created.id), answer, 0o600);
    expect(store.poll(created, NOW + 1)).toEqual({ kind: 'waiting' });
  });

  it.each([
    ['a used-code marker', { consumed: true }],
    ['an expiry marker', { expired: true }],
    ['a field this code never writes', { note: 'x' }],
  ])('keeps waiting while the answer holds a code and %s', (_label, extra) => {
    // Only an answer shaped exactly as submit writes one may hand over a code.
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    const answer = JSON.stringify({ requestId: created.id, deadline: NOW + TTL, code: CODE, ...extra });
    fileSystem.seedFile(answerPath(created.id), answer, 0o600);
    expect(store.poll(created, NOW + 1)).toEqual({ kind: 'waiting' });
  });

  it.each([
    ['no deadline', {}],
    ['a used-code marker in place of its deadline', { consumed: true }],
  ])('keeps waiting while the answer holds a code but %s', (_label, extra) => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    const answer = JSON.stringify({ requestId: created.id, code: CODE, ...extra });
    fileSystem.seedFile(answerPath(created.id), answer, 0o600);
    expect(store.poll(created, NOW + 1)).toEqual({ kind: 'waiting' });
  });

  it.each([
    ['another deadline', String(NOW + TTL + 1)],
    ['a deadline in text', `"${String(NOW + TTL)}"`],
    ['a deadline JSON reads as infinite', '1e999'],
  ])('hands over no code from an answer holding %s', (_label, deadline) => {
    // answerRecords always writes the request's own deadline.
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    const answer = `{"requestId":"${created.id}","deadline":${deadline},"code":"${CODE}"}`;
    fileSystem.seedFile(answerPath(created.id), answer, 0o600);
    expect(store.poll(created, NOW + 1)).toEqual({ kind: 'waiting' });
    expect(store.poll(created, NOW + TTL)).toEqual({ kind: 'expired' });
  });

  it.each(['1234', '12345678'])('hands over a %s code at the edge of the allowed length', (code) => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    const answer = JSON.stringify({ requestId: created.id, deadline: NOW + TTL, code });
    fileSystem.seedFile(answerPath(created.id), answer, 0o600);
    expect(store.poll(created, NOW + 1)).toEqual({ kind: 'code', code });
  });

  it('keeps waiting while the answer cannot be read', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    store.submit(created.id, CODE, NOW + 1);
    fileSystem.forcedFailures.set('openForRead', 'EACCES');
    expect(store.poll(created, NOW + 2)).toEqual({ kind: 'waiting' });
  });

  it('throws at the deadline when the taken answer cannot be read, after removing the request', () => {
    // An answer that exists but cannot be read may hold the user's code, so
    // reporting an expiry here would reroute the bank OTP to another channel.
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    store.submit(created.id, CODE, NOW + 1);
    fileSystem.forcedFailures.set('openForRead', 'EACCES');
    expect(() => store.poll(created, NOW + TTL)).toThrow(StorageError);
    expect(fileSystem.hasEntry(requestPath(created.id))).toBe(false);
    expect(fileSystem.hasEntry(answerPath(created.id))).toBe(true);
  });

  it('names the errno, and never the code, when the taken answer cannot be read', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    store.submit(created.id, CODE, NOW + 1);
    fileSystem.forcedFailures.set('openForRead', 'EACCES');
    expect(() => store.poll(created, NOW + TTL)).toThrow(/read the OTP answer.*EACCES/);
    expect(() => store.poll(created, NOW + TTL)).not.toThrow(new RegExp(CODE));
  });

  it('throws when the expiry cannot be recorded, after removing the request', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    fileSystem.forcedFailures.set('publishExclusive', 'EPERM');
    expect(() => store.poll(created, NOW + TTL)).toThrow(StorageError);
    expect(fileSystem.hasEntry(requestPath(created.id))).toBe(false);
    expect(fileSystem.hasEntry(answerPath(created.id))).toBe(false);
  });

  it('still returns the code when the tombstone cannot be written', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    store.submit(created.id, CODE, NOW + 1);
    fileSystem.forcedFailures.set('rename', 'EIO');
    expect(store.poll(created, NOW + 2)).toEqual({ kind: 'code', code: CODE });
    expect(fileSystem.hasEntry(requestPath(created.id))).toBe(false);
  });

  it('still returns the code when the request cannot be removed', () => {
    const { store, fileSystem } = makeStore();
    const created = store.create('leumi', TTL, NOW);
    store.submit(created.id, CODE, NOW + 1);
    fileSystem.forcedFailures.set('remove', 'EACCES');
    expect(store.poll(created, NOW + 2)).toEqual({ kind: 'code', code: CODE });
  });
});
