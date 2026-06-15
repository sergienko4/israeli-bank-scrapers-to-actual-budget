/**
 * Import queue / mediator job, batch, and lifecycle-callback types.
 */

import type { Procedure as ProcedureType } from './Procedure.js';

/** Source that triggered an import request. */
export type ImportSource = 'cron' | 'telegram' | 'api';

/** Options passed to ImportMediator.requestImport(). */
export interface IImportRequestOptions {
  /** Who triggered this import. */
  readonly source: ImportSource;
  /** Optional list of bank names; undefined = all banks. */
  readonly banks?: string[];
  /** Extra environment variables for the child process. */
  readonly extraEnv?: Record<string, string>;
}

/** A single queued import job. */
export interface IImportJob {
  /** Unique job identifier. */
  readonly id: string;
  /** Bank name (or comma-separated list / "all"). */
  readonly bankName: string;
  /** Batch this job belongs to. */
  readonly batchId: string;
  /** Source that triggered this import. */
  readonly source: ImportSource;
}

/** Result of a single import job. */
export interface IImportJobResult {
  /** The completed job. */
  readonly job: IImportJob;
  /** Child process exit code (0 = success). */
  readonly exitCode: number;
  /** Duration in milliseconds. */
  readonly durationMs: number;
}

/** Aggregate result of a batch of import jobs. */
export interface IBatchResult {
  /** Unique batch identifier. */
  readonly batchId: string;
  /** Source that triggered this batch. */
  readonly source: ImportSource;
  /** Individual job results. */
  readonly jobs: IImportJobResult[];
  /** Total duration in milliseconds. */
  readonly totalDurationMs: number;
  /** Number of successful jobs. */
  readonly successCount: number;
  /** Number of failed jobs. */
  readonly failureCount: number;
}

/** Callbacks for ImportQueue lifecycle events. */
export interface IQueueCallbacks<T, TResult = IImportJobResult> {
  /** Processes a single queued item. Returns the result. */
  readonly process: (item: T) => Promise<TResult>;
  /** Called after each item completes (success or failure). */
  readonly onJobComplete: (item: T, result: TResult | Error) => ProcedureType<{ status: string }>;
  /** Called when the queue drains completely. */
  readonly onQueueEmpty: () => ProcedureType<{ status: string }>;
}
