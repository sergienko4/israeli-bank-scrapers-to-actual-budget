/**
 * What an OTP request file and its answer file hold, and how to read them.
 *
 * <p>Both are read without trusting them. Anything that is not exactly what
 * this code writes reads as absent, so a damaged or foreign file can neither
 * surface as a request nor hand the importer a code.
 * @module
 */

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
type StoredRecords = Readonly<Record<string, unknown>>;

/** What the importer learns when it looks for the answer. */
export type OtpPoll =
  | { readonly kind: 'waiting' }
  | { readonly kind: 'code'; readonly code: string }
  | { readonly kind: 'expired' };

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
  if (typeof createdAt !== 'number' || typeof deadline !== 'number') return false;
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
 * @returns The code, or false unless the answer is this request's and holds text.
 */
export function codeIn(records: StoredRecords, request: IOtpRequest): string | false {
  const { code } = records;
  if (records.requestId !== request.id || typeof code !== 'string') return false;
  return code;
}
