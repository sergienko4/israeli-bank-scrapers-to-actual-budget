/**
 * What an OTP request file and its answer file hold, and how to read them.
 *
 * <p>Both are read without trusting them. Anything that is not exactly what
 * this code writes reads as absent, so a damaged or foreign file can neither
 * surface as a request nor hand the importer a code. That includes a time
 * JSON can spell but a clock never reaches, such as `1e999`, a code the
 * portal's own route would have refused, and a file that held a `__proto__`
 * key the parser left out.
 * @module
 */

import { OTP_CODE_PATTERN } from '../../Contract/Otp.js';
import type { IStoreSnapshot } from '../../Storage/StoreTypes.js';

/** The only codes an answer may hand the importer. */
const WELL_FORMED_CODE = new RegExp(OTP_CODE_PATTERN);

/** The fields an answer holding the user's code is written with, and no others. */
const CODE_ANSWER_FIELDS: ReadonlySet<string> = new Set(['requestId', 'deadline', 'code']);

/** The fields a used code's tombstone is written with, and no others. */
const TOMBSTONE_FIELDS: ReadonlySet<string> = new Set(['requestId', 'deadline', 'consumed']);

/** The fields the importer writes a request with, and no others. */
const REQUEST_FIELDS: ReadonlySet<string> = new Set(['id', 'bankId', 'createdAt', 'deadline']);

/** A pending OTP request, as the importer publishes it. */
export interface IOtpRequest {
  /** Lower-case UUID the app submits its code against; also names the files. */
  id: string;
  /** Bank id the OTP is for (shown to the user). */
  bankId: string;
  /** Creation time, epoch ms. */
  createdAt: number;
  /** Expiry time, epoch ms; the request is dead from this moment on. */
  deadline: number;
}

/** How a request was settled: the user's code, an expiry, or a used code. */
export type OtpOutcome =
  | { readonly code: string }
  | { readonly expired: true }
  | { readonly consumed: true };

/** The records a healthy OTP file holds, as the store read them. */
export type StoredRecords = Readonly<Record<string, unknown>>;

/** What the importer learns when it looks for the answer. */
export type OtpPoll =
  | { readonly kind: 'waiting' }
  | { readonly kind: 'code'; readonly code: string }
  | { readonly kind: 'expired' };

/** What a file that cannot be trusted holds. */
const NO_RECORDS: StoredRecords = Object.freeze({});

/**
 * Picks the records an OTP file can be read for.
 *
 * <p>Only a healthy file holds what this code writes. A damaged one has no
 * records, and a stripped one held a `__proto__` key, which this code never
 * writes, so it reads as absent too.
 * @param snapshot - What the store read from the file.
 * @returns Its records when it is healthy, otherwise none.
 */
export function trustedRecords(snapshot: IStoreSnapshot): StoredRecords {
  return snapshot.state === 'healthy' ? snapshot.records : NO_RECORDS;
}

/**
 * Reports whether records hold no field beyond the given ones.
 *
 * <p>Each caller checks every one of those fields' values, so together they
 * require exactly those fields: an answer also marked used or expired is not
 * taken for a code, and a request with a field the importer never writes is
 * not read.
 * @param records - The records of a healthy OTP file.
 * @param fields - The fields such a file is written with.
 * @returns Whether every field name is one of those.
 */
function holdsOnly(records: StoredRecords, fields: ReadonlySet<string>): boolean {
  const names = Object.keys(records);
  return names.every((name) => fields.has(name));
}

/**
 * Reports whether a stored value is a time a clock can reach.
 * @param value - The stored value.
 * @returns Whether it is a finite number.
 */
function isInstant(value: unknown): value is number {
  return Number.isFinite(value);
}

/**
 * Reads a request out of a request file's records.
 * @param records - The records of a healthy request file.
 * @param id - The id the file is named under.
 * @returns The request's public fields, or false unless they are well formed,
 *   the only fields, and stored under the id the file is named for.
 */
export function requestIn(records: StoredRecords, id: string): IOtpRequest | false {
  const { bankId, createdAt, deadline } = records;
  if (!holdsOnly(records, REQUEST_FIELDS)) return false;
  if (records.id !== id || typeof bankId !== 'string') return false;
  if (!isInstant(createdAt) || !isInstant(deadline)) return false;
  return { id, bankId, createdAt, deadline };
}

/**
 * Builds the records an answer file holds.
 *
 * <p>The deadline travels with every answer so the sweep can age an answer
 * without its request, which the importer removes first.
 * @param request - The request being answered.
 * @param outcome - How it was settled.
 * @returns The answer's records.
 */
export function answerRecords(request: IOtpRequest, outcome: OtpOutcome): Record<string, unknown> {
  return { requestId: request.id, deadline: request.deadline, ...outcome };
}

/**
 * Reads the user's code out of an answer file's records.
 * @param records - The records of a healthy answer file.
 * @param request - The request the answer must belong to.
 * @returns The code, or false unless the answer is this request's, carries
 *   its deadline, holds only the fields a code answer is written with, and
 *   holds a well-formed code.
 */
export function codeIn(records: StoredRecords, request: IOtpRequest): string | false {
  const { code } = records;
  if (!holdsOnly(records, CODE_ANSWER_FIELDS) || records.requestId !== request.id) return false;
  if (records.deadline !== request.deadline) return false;
  return typeof code === 'string' && WELL_FORMED_CODE.test(code) ? code : false;
}

/**
 * Reports whether an answer file's records are the tombstone the importer
 * leaves once it has used this request's code.
 * @param records - The records of a healthy answer file.
 * @param request - The request the answer must belong to.
 * @returns Whether they are this request's tombstone: its id and deadline,
 *   marked used, and no other field.
 */
export function isConsumedIn(records: StoredRecords, request: IOtpRequest): boolean {
  if (!holdsOnly(records, TOMBSTONE_FIELDS) || records.requestId !== request.id) return false;
  return records.deadline === request.deadline && records.consumed === true;
}
