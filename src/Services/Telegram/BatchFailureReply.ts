/**
 * BatchFailureReply — builds the Telegram failure message for a completed
 * import batch.
 *
 * The importer runs ONE child process per bank, and each child writes its own
 * audit entry with `totalBanks: 1`. Deriving the reply from the most recent
 * audit entry therefore describes a single bank and reads as though the whole
 * run failed. The batch result is the only authoritative view of the run, so
 * the reply is built from its per-job exit codes and the audit entries are used
 * only to enrich each failed bank with its error text.
 */

import type { IBatchResult } from '../../Types/Index.js';
import type { IAuditEntry, IAuditLog } from '../AuditLogService.js';
import {
  formatFailedBankLine,
  formatFailedBanks,
  isFreshEntry,
} from '../TelegramCommandFormatters.js';

/** Job label used when a single child process imports every configured bank. */
const AGGREGATE_JOB_LABEL = 'all';

/** Maximum number of failed banks listed before collapsing into a counter. */
const FAILED_BANK_DISPLAY_CAP = 10;

/** Closing hint appended to every per-bank failure reply. */
const FAILURE_FOOTER = 'Use /retry to re-run the failed bank(s), or /logs for details.';

/** Inputs for {@link buildBatchErrorReply}. */
export interface IBatchErrorReplyArgs {
  /** The completed batch with failure information. */
  readonly batch: IBatchResult;
  /** Optional fresh audit entry recorded during this batch. */
  readonly entry: IAuditEntry | undefined;
  /** Audit entries recorded during this batch, one per bank child process. */
  readonly entries?: readonly IAuditEntry[];
  /** Optional audit log used for failure-streak annotations. */
  readonly auditLog: IAuditLog | undefined;
}

/** Inputs for the per-bank branch of {@link buildBatchErrorReply}. */
interface IPerBankFailureArgs {
  /** Total number of bank jobs in the batch. */
  readonly totalBanks: number;
  /** Names of the banks whose job exited non-zero. */
  readonly failed: readonly string[];
  /** Batch duration in whole seconds, already formatted. */
  readonly durationSec: string;
  /** Per-bank error text keyed by bank name. */
  readonly errors: ReadonlyMap<string, string>;
  /** Optional audit log used for failure-streak annotations. */
  readonly auditLog: IAuditLog | undefined;
}

/**
 * Builds the multi-line error reply for a batch that reported failures.
 *
 * Falls back to the audit-entry summary for aggregate batches (a single child
 * process covering every bank), where that entry does describe the whole run.
 * @param args - Batch, audit entries recorded during it, and the audit log.
 * @returns Reply text suitable for sendMessage().
 */
export function buildBatchErrorReply(args: IBatchErrorReplyArgs): string {
  const dur = (args.batch.totalDurationMs / 1000).toFixed(0);
  const failed = failedBankLabels(args.batch);
  if (failed.length === 0) return buildAggregateReply(args, dur);
  const perBank = toPerBankArgs(args, failed, dur);
  return buildPerBankReply(perBank);
}

/**
 * Lists the banks whose dedicated child process exited non-zero.
 *
 * Returns an empty list for aggregate batches so the caller keeps the legacy
 * audit-entry rendering, which is accurate when one job covers every bank.
 * @param batch - The completed batch result.
 * @returns Failed bank names, or an empty list for aggregate batches.
 */
export function failedBankLabels(batch: IBatchResult): readonly string[] {
  const labels = batch.jobs.map(j => j.job.bankName);
  if (labels.includes(AGGREGATE_JOB_LABEL)) return [];
  const failedJobs = batch.jobs.filter(j => j.exitCode !== 0);
  return failedJobs.map(j => j.job.bankName);
}

/**
 * Renders the legacy audit-entry reply used for aggregate batches.
 * @param args - Batch, optional fresh audit entry, and audit log.
 * @param durationSec - Batch duration in whole seconds.
 * @returns Reply text derived from the audit entry, or a generic fallback.
 */
function buildAggregateReply(args: IBatchErrorReplyArgs, durationSec: string): string {
  const entry = args.entry;
  if (!entry || !isFreshEntry(entry, args.batch)) {
    return `❌ Import failed (${durationSec}s). Use /logs for details.`;
  }
  return formatFailedBanks(entry, durationSec, args.auditLog);
}

/**
 * Assembles the per-bank branch inputs from the reply arguments.
 * @param args - Original reply arguments.
 * @param failed - Names of the banks whose job exited non-zero.
 * @param durationSec - Batch duration in whole seconds.
 * @returns Inputs for {@link buildPerBankReply}.
 */
function toPerBankArgs(
  args: IBatchErrorReplyArgs, failed: readonly string[], durationSec: string,
): IPerBankFailureArgs {
  const errors = indexBankErrors(args.entries ?? []);
  return {
    totalBanks: args.batch.jobs.length, failed, durationSec,
    errors, auditLog: args.auditLog,
  };
}

/**
 * Indexes the error text of every failed bank across the batch audit entries.
 * @param entries - Audit entries recorded during the batch (one per bank).
 * @returns Map of bank name to its recorded error text.
 */
export function indexBankErrors(
  entries: readonly IAuditEntry[],
): ReadonlyMap<string, string> {
  const failures = entries.flatMap(e => e.banks.filter(isFailureWithError));
  const pairs = failures.map(b => [b.name, b.error ?? ''] as const);
  return new Map(pairs);
}

/**
 * Reports whether an audit bank record failed and carries error text.
 * @param bank - Per-bank record from an audit entry.
 * @returns True when the bank failed with a recorded error message.
 */
function isFailureWithError(bank: IAuditEntry['banks'][number]): boolean {
  return bank.status === 'failure' && Boolean(bank.error);
}

/**
 * Renders the header plus one line per failed bank.
 * @param args - Totals, failed bank names, duration, errors, and audit log.
 * @returns Multi-line reply text.
 */
function buildPerBankReply(args: IPerBankFailureArgs): string {
  const header = buildFailureHeader(args.totalBanks, args.failed.length, args.durationSec);
  const bankLines = buildFailedBankLines(args);
  return [header, ...bankLines, '', FAILURE_FOOTER].join('\n');
}

/**
 * Builds the reply header, distinguishing a partial run from a total failure.
 * @param totalBanks - Number of banks the batch attempted.
 * @param failedCount - Number of banks that failed.
 * @param durationSec - Batch duration in whole seconds.
 * @returns Single header line.
 */
export function buildFailureHeader(
  totalBanks: number, failedCount: number, durationSec: string,
): string {
  const okCount = totalBanks - failedCount;
  if (okCount <= 0) {
    return `❌ Import failed (${durationSec}s) — all ${String(totalBanks)} bank(s) failed:`;
  }
  return partialHeader(okCount, totalBanks, durationSec);
}

/**
 * Builds the header used when at least one bank imported successfully.
 * @param okCount - Number of banks that succeeded.
 * @param totalBanks - Number of banks the batch attempted.
 * @param durationSec - Batch duration in whole seconds.
 * @returns Single header line describing the partial run.
 */
function partialHeader(okCount: number, totalBanks: number, durationSec: string): string {
  const failedCount = totalBanks - okCount;
  const ratio = `${String(okCount)}/${String(totalBanks)}`;
  return `⚠️ Partial import (${durationSec}s) — ${ratio} banks OK, ` +
    `${String(failedCount)} failed:`;
}

/**
 * Builds one bullet line per failed bank, capped to keep the reply readable.
 * @param args - Failed bank names, per-bank errors, and the audit log.
 * @returns Bullet lines, plus an overflow counter when the cap is exceeded.
 */
function buildFailedBankLines(args: IPerBankFailureArgs): readonly string[] {
  const shown = args.failed.slice(0, FAILED_BANK_DISPLAY_CAP);
  const lines = shown.map(name => formatOneBank(name, args));
  const overflow = args.failed.length - shown.length;
  if (overflow <= 0) return lines;
  return [...lines, `  ...and ${String(overflow)} more`];
}

/**
 * Formats a single failed bank using its indexed error text.
 * @param name - Bank name as used by the job label and audit entries.
 * @param args - Per-bank branch inputs carrying errors and the audit log.
 * @returns Bullet line with advice and failure-streak annotations.
 */
function formatOneBank(name: string, args: IPerBankFailureArgs): string {
  const error = args.errors.get(name);
  return formatFailedBankLine(name, error, args.auditLog);
}
