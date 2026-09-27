/**
 * What an OTP request file and its answer file hold, and how to read them.
 *
 * <p>Both are read without trusting them. Anything that is not exactly what
 * this code writes reads as absent, so a damaged or foreign file can neither
 * surface as a request nor hand the importer a code. That includes a time
 * JSON can spell but a clock never reaches, such as `1e999`, and a code the
 * portal's own route would have refused.
 * @module
 */

import { OTP_CODE_PATTERN } from '../../Contract/Otp.js';

/** The only codes an answer may hand the importer. */
const WELL_FORMED_CODE = new RegExp(OTP_CODE_PATTERN);

/** The fields an answer holding the user's code is written with, and no others. */
const CODE_ANSWER_FIELDS: ReadonlySet<string> = new Set(['requestId', 'deadline', 'code']);

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
 * @returns The request's public fields, or false unless they are well formed
 *   and stored under the id the file is named for.
 */
export function requestIn(records: StoredRecords, id: string): IOtpRequest | false {
  const { bankId, createdAt, deadline } = records;
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
 * Reports whether a field is one a code answer is written with.
 * @param field - A field name read from an answer.
 * @returns Whether a code answer carries it.
 */
function isCodeAnswerField(field: string): boolean {
  return CODE_ANSWER_FIELDS.has(field);
}

/**
 * Reports whether an answer holds exactly the fields a submitted code is
 * written with, so one also marked used or expired is not taken for a code.
 * @param records - The records of a healthy answer file.
 * @returns Whether its field names are exactly those.
 */
function isCodeAnswer(records: StoredRecords): boolean {
  const fields = Object.keys(records);
  return fields.length === CODE_ANSWER_FIELDS.size && fields.every(isCodeAnswerField);
}

/**
 * Reads the user's code out of an answer file's records.
 * @param records - The records of a healthy answer file.
 * @param request - The request the answer must belong to.
 * @returns The code, or false unless the answer is this request's, holds
 *   only the fields a code answer is written with, and holds a well-formed code.
 */
export function codeIn(records: StoredRecords, request: IOtpRequest): string | false {
  const { code } = records;
  if (!isCodeAnswer(records) || records.requestId !== request.id) return false;
  return typeof code === 'string' && WELL_FORMED_CODE.test(code) ? code : false;
}
