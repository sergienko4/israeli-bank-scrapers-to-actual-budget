/**
 * File-backed registry of app-OTP requests, shared across the process boundary
 * between the import child (which needs an OTP during a 2FA bank login) and the
 * portal (which receives the code the user enters in the mobile app).
 *
 * <p>Every request is its own file, and every request has at most one answer.
 * The importer {@link create}s a request, publishing it whole under a name no
 * other request can take, and never rewrites it. The answer is published
 * exclusively too, by whichever side is first: the portal {@link submit}s the
 * user's code, or the importer, {@link poll}ing at the deadline, records the
 * expiry. The loser learns that it lost, so a code is either used or refused,
 * never accepted and then dropped. A used code is replaced by a tombstone:
 * the code leaves the disk but the answer's name stays taken, so no second
 * code is accepted for the same request.
 *
 * <p>Two importers, or an importer and the portal, therefore never write the
 * same file, and no read-modify-write of shared state remains to race. Every
 * file is owner-only and read without trusting it. Codes are never logged by
 * this module, and no error it raises carries one.
 *
 * <p>Publishing to a free name needs hard links, so the data volume must
 * support them; on one that does not, create and submit fail rather than
 * racing.
 */
import { randomUUID } from 'node:crypto';

import StorageError from '../../Errors/StorageError.js';
import type { IFileSystem } from '../../Storage/FileSystemPort.js';
import SecureJsonStore from '../../Storage/SecureJsonStore.js';
import type { ISweepReport } from '../../Storage/StoreTypes.js';
import type { IProcedureFailure, Procedure } from '../../Types/Index.js';
import { succeed } from '../../Types/ProcedureHelpers.js';
import UUID_PATTERN from '../../Utils/IdPatterns.js';
import OtpFileNames from './OtpFileNames.js';
import sweepOtpFiles from './OtpFileSweep.js';
import {
  answerRecords, codeIn, type IOtpRequest, type OtpPoll, requestIn, trustedRecords,
} from './OtpRecords.js';

export type { IOtpRequest, OtpPoll } from './OtpRecords.js';

/** The poll result while no answer has arrived. */
const WAITING: OtpPoll = { kind: 'waiting' };

/** The poll result once the request expired unanswered. */
const EXPIRED: OtpPoll = { kind: 'expired' };

/**
 * Builds the error a failed read or write raises, naming its errno.
 *
 * <p>The failure's message carries paths and errnos only; no code reaches it.
 * @param action - What could not be done.
 * @param failure - Why.
 * @returns The error to throw.
 */
function storageError(action: string, failure: IProcedureFailure): StorageError {
  return new StorageError(`${action} (${failure.status}): ${failure.message}`);
}

/** Persists app-OTP requests and their answers as files on a shared volume. */
export default class OtpRequestStore {
  private readonly _fileSystem: IFileSystem;

  private readonly _names: OtpFileNames;

  /**
   * Binds the store to one directory on one filesystem.
   * @param fileSystem - Injected filesystem access.
   * @param basePath - Absolute `OTP_REQUESTS_PATH`; every file name derives from it.
   */
  constructor(fileSystem: IFileSystem, basePath: string) {
    this._fileSystem = fileSystem;
    this._names = new OtpFileNames(basePath);
  }

  /**
   * Publishes a new request as its own file.
   * @param bankId - The bank the OTP is for.
   * @param ttlMs - Time-to-live in milliseconds before the request expires.
   * @param now - Current time in epoch ms (defaults to Date.now()).
   * @returns The created request.
   * @throws StorageError when the request cannot be published.
   */
  public create(bankId: string, ttlMs: number, now: number = Date.now()): IOtpRequest {
    const id = randomUUID();
    const request: IOtpRequest = { id, bankId, createdAt: now, deadline: now + ttlMs };
    const committed = this.requestStore(id).commitNew({ ...request });
    if (!committed.success) throw storageError('Could not save the OTP request', committed);
    return request;
  }

  /**
   * Lists the live requests that have no answer yet, oldest first.
   * @param now - Current time in epoch ms (defaults to Date.now()).
   * @returns The pending requests; none when the directory cannot be read.
   */
  public pending(now: number = Date.now()): IOtpRequest[] {
    const listed = this._fileSystem.listNames(this._names.directory);
    if (!listed.success) return [];
    const ids = this._names.unansweredIds(listed.data);
    const live = ids.map((id) => this.liveRequest(id, now));
    const requests = live.filter((request): request is IOtpRequest => request !== false);
    return requests.sort((first, second) => first.createdAt - second.createdAt);
  }

  /**
   * Publishes the user's code as a live request's answer.
   * @param id - The request id to submit against.
   * @param code - The OTP code entered by the user.
   * @param now - Current time in epoch ms (defaults to Date.now()).
   * @returns True when the code was accepted; false when there is no such live
   *   request, or it already has an answer.
   * @throws StorageError when the request cannot be read or the answer saved.
   */
  public submit(id: string, code: string, now: number = Date.now()): boolean {
    if (!UUID_PATTERN.test(id)) return false;
    const read = this.readRequest(id);
    if (!read.success) throw storageError('Could not read the OTP request', read);
    if (read.data === false || read.data.deadline <= now) return false;
    const answer = answerRecords(read.data, { code });
    const published = this.answerStore(id).commitNew(answer);
    if (published.success) return true;
    if (published.status === 'EEXIST') return false;
    throw storageError('Could not save the OTP code', published);
  }

  /**
   * Looks for the answer to a request, settling it once there is one or the
   * deadline is reached.
   *
   * <p>A code ends the request: it is returned, the request file removed and
   * the code replaced by a tombstone, both best-effort, so a code that has
   * arrived is never withheld. At the deadline the importer races the portal
   * for the answer: winning records the expiry, and losing means the portal
   * published a code in time, which is returned.
   * @param request - The request {@link create} returned.
   * @param now - Current time in epoch ms (defaults to Date.now()).
   * @returns Whether to keep waiting, the code, or that the request expired.
   * @throws StorageError when the expiry cannot be recorded, or the answer
   *   that beat it cannot be read; the request file is removed first, so the
   *   portal stops offering it.
   */
  public poll(request: IOtpRequest, now: number = Date.now()): OtpPoll {
    const polled = now < request.deadline ? this.awaitCode(request) : this.expire(request);
    if (polled.kind !== 'waiting') this.removeRequest(request);
    return polled;
  }

  /**
   * Removes the OTP files nothing will read again.
   * @returns How many were removed, or why the directory could not be read.
   */
  public sweepStagedLeftovers(): Procedure<ISweepReport> {
    return sweepOtpFiles(this._fileSystem, this._names);
  }

  /**
   * Reads a request that is still live.
   * @param id - The request id.
   * @param now - Current time in epoch ms.
   * @returns The request, or false when it cannot be read, is not well formed, or is dead.
   */
  private liveRequest(id: string, now: number): IOtpRequest | false {
    const read = this.readRequest(id);
    if (!read.success || read.data === false) return false;
    return read.data.deadline > now && read.data;
  }

  /**
   * Reads a request file.
   *
   * <p>An absent, damaged or stripped file yields no records, so it holds no
   * well-formed request either.
   * @param id - The request id, known to be a UUID.
   * @returns The request, false when it is absent or not well formed, or why
   *   the file could not be read.
   */
  private readRequest(id: string): Procedure<IOtpRequest | false> {
    const snapshot = this.requestStore(id).read();
    if (!snapshot.success) return snapshot;
    const records = trustedRecords(snapshot.data);
    const request = requestIn(records, id);
    return succeed(request);
  }

  /**
   * Takes the code if one has arrived before the deadline.
   *
   * <p>An answer that cannot be read is tried again on the next poll; at the
   * deadline {@link expire} reports it rather than calling it an expiry.
   * @param request - The request being polled.
   * @returns The code, or that the importer should keep waiting.
   */
  private awaitCode(request: IOtpRequest): OtpPoll {
    const code = this.readCode(request);
    if (!code.success) return WAITING;
    return this.settle(request, code.data, WAITING);
  }

  /**
   * Records the expiry as the answer, unless the portal published a code first.
   * @param request - The request whose deadline was reached.
   * @returns The code the portal published in time, or the expiry.
   * @throws StorageError when the expiry cannot be recorded, or the answer
   *   that beat it cannot be read, after removing the request file.
   */
  private expire(request: IOtpRequest): OtpPoll {
    const answer = answerRecords(request, { expired: true });
    const expiry = this.answerStore(request.id).commitNew(answer);
    if (expiry.success) return EXPIRED;
    if (expiry.status === 'EEXIST') return this.takeWinningAnswer(request);
    throw this.abandon(request, 'Could not record the OTP expiry', expiry);
  }

  /**
   * Reads the answer that was published before the expiry could be.
   *
   * <p>An answer that exists but cannot be read may hold the user's code, so
   * it is reported as a storage failure: an expiry would let the caller fall
   * back to another OTP channel.
   * @param request - The request whose deadline was reached.
   * @returns The code the answer holds, or the expiry when it holds none.
   * @throws StorageError when the answer cannot be read, after removing the
   *   request file.
   */
  private takeWinningAnswer(request: IOtpRequest): OtpPoll {
    const code = this.readCode(request);
    if (!code.success) throw this.abandon(request, 'Could not read the OTP answer', code);
    return this.settle(request, code.data, EXPIRED);
  }

  /**
   * Takes a code, leaving a tombstone; or returns the fallback when there is none.
   * @param request - The request being polled.
   * @param code - The code the answer holds, or false.
   * @param fallback - What to return when the answer holds no usable code.
   * @returns The code, or the fallback.
   */
  private settle(request: IOtpRequest, code: string | false, fallback: OtpPoll): OtpPoll {
    if (code === false) return fallback;
    this.leaveTombstone(request);
    return { kind: 'code', code };
  }

  /**
   * Removes the request file, so the portal stops offering it, and builds the
   * error the poll then throws.
   * @param request - The request that cannot be settled.
   * @param action - What could not be done.
   * @param failure - Why.
   * @returns The error to throw.
   */
  private abandon(request: IOtpRequest, action: string, failure: IProcedureFailure): StorageError {
    this.removeRequest(request);
    return storageError(action, failure);
  }

  /**
   * Reads the user's code from a request's answer.
   *
   * <p>An absent, damaged or stripped answer yields no records, so no code.
   * @param request - The request being polled.
   * @returns The code, false when there is none this request can use, or why
   *   the answer could not be read.
   */
  private readCode(request: IOtpRequest): Procedure<string | false> {
    const snapshot = this.answerStore(request.id).read();
    if (!snapshot.success) return snapshot;
    const records = trustedRecords(snapshot.data);
    const code = codeIn(records, request);
    return succeed(code);
  }

  /**
   * Replaces a used code with a tombstone, best-effort, keeping the answer's
   * name taken.
   *
   * <p>If the replacement fails the code stays until the sweep removes the
   * answer, an hour past the deadline; the request is gone by then, so the
   * portal no longer accepts or lists anything for it.
   * @param request - The request whose code was used.
   */
  private leaveTombstone(request: IOtpRequest): void {
    const records = answerRecords(request, { consumed: true });
    this.answerStore(request.id).commit({ records, shouldQuarantine: false });
  }

  /**
   * Removes a settled request's file, best-effort; the sweep collects a survivor.
   * @param request - The settled request.
   */
  private removeRequest(request: IOtpRequest): void {
    const requestPath = this._names.requestPath(request.id);
    this._fileSystem.remove(requestPath);
  }

  /**
   * Opens a request's own file.
   * @param id - The request id, known to be a UUID.
   * @returns A store over the request file.
   */
  private requestStore(id: string): SecureJsonStore {
    const requestPath = this._names.requestPath(id);
    return new SecureJsonStore(this._fileSystem, requestPath);
  }

  /**
   * Opens a request's answer file.
   * @param id - The request id, known to be a UUID.
   * @returns A store over the answer file.
   */
  private answerStore(id: string): SecureJsonStore {
    const answerPath = this._names.answerPath(id);
    return new SecureJsonStore(this._fileSystem, answerPath);
  }
}
