/**
 * Result Pattern types for the Israeli Bank Importer.
 * Every function returns Procedure<T> instead of throwing exceptions.
 * Discriminated union: IProcedureSuccess<T> | IProcedureFailure.
 */

/** Successful outcome carrying a data payload. */
export interface IProcedureSuccess<T> {
  readonly success: true;
  readonly status: string;
  readonly data: T;
}

/**
 * Failed outcome carrying an error message, an optional original Error, and an
 * optional structured breakdown ({@link IProcedureFailure.details}) of the
 * distinct reasons behind a composite failure (e.g. one entry per validation
 * gate violation), so callers can present them individually instead of parsing
 * the joined `message`.
 */
export interface IProcedureFailure {
  readonly success: false;
  readonly status: string;
  readonly message: string;
  readonly error?: Error;
  readonly details?: readonly string[];
}

/**
 * Discriminated union representing either a success or failure result.
 * Use `isSuccess()` / `isFail()` guards for type narrowing.
 */
export type Procedure<T> = IProcedureSuccess<T> | IProcedureFailure;
