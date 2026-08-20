/**
 * CardRefundCleanup — one-off operator command that removes credit-card
 * refund rows this importer wrote with an inverted sign before the
 * israeli-bank-scrapers 8.6.7 upgrade.
 *
 * Owns every side effect (Actual Budget connection, AQL query, row
 * deletion) so {@link findStaleRefundCandidates} stays pure and
 * unit-testable. Configuration and the operator's `--confirm` decision are
 * injected by the composition root rather than read here, keeping this
 * module free of Config-layer coupling and of `process.argv`.
 * See StaleRefundFinder.ts for why stale rows exist and why the match
 * cannot be proven from stored data alone.
 *
 * SAFETY CONTRACT: reports only by default. Deletion happens exclusively
 * when the operator passes `--confirm`, and only ever targets the
 * negative row of a matched pair — the corrected row is never touched.
 */

import api from '@actual-app/api';

import { getLogger } from '../../Logger/Index.js';
import { CREDIT_CARD_BANKS } from '../../Types/BankCatalog.js';
import type { IImporterConfig } from '../../Types/Index.js';
import { errorMessage } from '../../Utils/Index.js';
import type { IStaleRefundCandidate, IStaleRefundRow } from './StaleRefundFinder.js';
import findStaleRefundCandidates from './StaleRefundFinder.js';

/** Warning appended to every report; the match is a heuristic, not a proof. */
const AMBIGUITY_WARNING: readonly string[] = [
  '  WARNING: a genuine same-day, same-merchant purchase and refund of',
  '  equal value looks identical to a stale pair. Review each row in',
  '  Actual Budget before deleting.',
];

/**
 * Connects to Actual Budget using the configured credentials.
 *
 * @param config - The loaded importer configuration.
 * @returns The sync ID of the budget that was downloaded.
 */
async function connect(config: IImporterConfig): Promise<string> {
  const init = config.actual.init;
  await api.init({ dataDir: init.dataDir, serverURL: init.serverURL, password: init.password });
  const budget = config.actual.budget;
  const password = budget.password ?? undefined;
  await api.downloadBudget(budget.syncId, { password });
  return budget.syncId;
}

/**
 * Collects the Actual account IDs that receive credit-card transactions.
 *
 * Non-card banks are skipped entirely — their signs were never flipped,
 * so they cannot hold the artefact this command removes.
 *
 * @param config - The loaded importer configuration.
 * @returns Deduplicated Actual account UUIDs for card banks only.
 */
function cardAccountIds(config: IImporterConfig): string[] {
  const ids = new Set<string>();
  const entries = Object.entries(config.banks);
  for (const [bankName, bank] of entries) {
    const key = bankName.toLowerCase();
    if (!CREDIT_CARD_BANKS.has(key)) continue;
    for (const target of bank.targets ?? []) ids.add(target.actualAccountId);
  }
  return [...ids];
}

/**
 * Reads the rows the matcher needs from one Actual Budget account.
 *
 * @param accountId - UUID of the Actual account to read.
 * @returns The account's rows, or an empty array when Actual yields none.
 */
async function queryRows(accountId: string): Promise<IStaleRefundRow[]> {
  const query = api.q('transactions')
    .filter({ account: accountId })
    .select(['id', 'date', 'amount', 'imported_id', 'imported_payee']);
  const result = await api.aqlQuery(query);
  const payload = result as { data?: IStaleRefundRow[] } | null;
  return payload?.data ?? [];
}

/**
 * Gathers candidates across every configured credit-card account.
 *
 * @param config - The loaded importer configuration.
 * @returns Every candidate found, in account order.
 */
async function collectCandidates(config: IImporterConfig): Promise<IStaleRefundCandidate[]> {
  const accountIds = cardAccountIds(config);
  const queries = accountIds.map((accountId) => queryRows(accountId));
  const rowSets = await Promise.all(queries);
  return rowSets.flatMap((rows) => findStaleRefundCandidates(rows));
}

/**
 * Renders one candidate as a single human-readable report line.
 *
 * @param candidate - The candidate pair to render.
 * @returns A formatted line showing date, merchant and both amounts.
 */
function formatCandidate(candidate: IStaleRefundCandidate): string {
  const stale = (candidate.staleAmount / 100).toFixed(2);
  const corrected = (candidate.correctedAmount / 100).toFixed(2);
  return `     ${candidate.date}  ${candidate.description}  ${stale} -> kept ${corrected}`;
}

/**
 * Builds the full report as plain lines, keeping formatting testable.
 *
 * @param candidates - Every candidate discovered across card accounts.
 * @returns Header, one line per candidate, then the ambiguity warning.
 */
function buildReport(candidates: readonly IStaleRefundCandidate[]): string[] {
  const header = `Found ${String(candidates.length)} suspected stale refund row(s):`;
  const lines = candidates.map((candidate) => formatCandidate(candidate));
  return [header, ...lines, ...AMBIGUITY_WARNING];
}

/**
 * Writes the report to the configured logger.
 *
 * @param candidates - Every candidate discovered across card accounts.
 * @returns The number of lines emitted.
 */
function emitReport(candidates: readonly IStaleRefundCandidate[]): number {
  const log = getLogger();
  const lines = buildReport(candidates);
  for (const line of lines) log.info(line);
  return lines.length;
}

/**
 * Deletes one stale row and records it, so a mid-run failure still leaves
 * an audit trail of exactly which rows were already removed.
 *
 * @param candidate - The candidate whose stale row should be deleted.
 * @returns The id of the row that was deleted.
 */
async function deleteOne(candidate: IStaleRefundCandidate): Promise<string> {
  await api.deleteTransaction(candidate.staleRowId);
  getLogger().info(`Deleted stale refund row ${candidate.staleRowId}.`);
  return candidate.staleRowId;
}

/**
 * Deletes the stale row of every candidate pair, leaving the corrected row.
 *
 * @param candidates - The candidates the operator confirmed for deletion.
 * @returns The number of rows deleted.
 */
async function deleteCandidates(candidates: readonly IStaleRefundCandidate[]): Promise<number> {
  const deletions = candidates.map((candidate) => deleteOne(candidate));
  const deleted = await Promise.all(deletions);
  getLogger().info(`Deleted ${String(deleted.length)} stale refund row(s).`);
  return deleted.length;
}

/**
 * Reports the clean-slate outcome when nothing needs removing.
 *
 * @returns Exit code 0 — an empty result is a success, not a failure.
 */
function reportNoCandidates(): number {
  getLogger().info('No stale credit-card refund rows found — nothing to clean up.');
  return 0;
}

/**
 * Reports the dry-run outcome, leaving every candidate row untouched.
 *
 * @returns Exit code 0 — reporting without deleting is the default success path.
 */
function reportDryRun(): number {
  getLogger().info('Dry run — re-run with --confirm to delete the stale rows.');
  return 0;
}

/**
 * Applies the report-then-optionally-delete decision for found candidates.
 *
 * @param candidates - Every candidate discovered across card accounts.
 * @param isConfirmed - True when the operator authorised deletion.
 * @returns Exit code 0 — the command never fails on candidate count alone.
 */
async function resolveCandidates(
  candidates: readonly IStaleRefundCandidate[], isConfirmed: boolean,
): Promise<number> {
  emitReport(candidates);
  if (!isConfirmed) return reportDryRun();
  await deleteCandidates(candidates);
  return 0;
}

/**
 * Runs the cleanup end to end, without the error boundary.
 *
 * @param config - The loaded importer configuration.
 * @param isConfirmed - True when the operator authorised deletion.
 * @returns Exit code 0 once the report (and any deletion) has completed.
 */
async function runCleanup(config: IImporterConfig, isConfirmed: boolean): Promise<number> {
  await connect(config);
  const candidates = await collectCandidates(config);
  if (candidates.length === 0) return reportNoCandidates();
  return await resolveCandidates(candidates, isConfirmed);
}

/**
 * Closes the Actual client without letting a shutdown failure mask the run's
 * own outcome — a teardown error must never turn a clean run into a crash.
 *
 * @returns True when shutdown completed, false when it failed.
 */
async function shutdownQuietly(): Promise<boolean> {
  try {
    await api.shutdown();
    return true;
  } catch (error: unknown) {
    getLogger().warn(`Actual Budget shutdown failed: ${errorMessage(error)}`);
    return false;
  }
}

/**
 * Runs the cleanup, converting any unexpected failure into exit code 1.
 *
 * @param config - The loaded importer configuration.
 * @param isConfirmed - True when the operator authorised deletion.
 * @returns Exit code: 0 on success, 1 when the run could not complete.
 */
async function runGuarded(config: IImporterConfig, isConfirmed: boolean): Promise<number> {
  try {
    return await runCleanup(config, isConfirmed);
  } catch (error: unknown) {
    getLogger().error(`Card refund cleanup failed: ${errorMessage(error)}`);
    return 1;
  }
}

/**
 * CLI entry point for `--cleanup-card-refunds` mode.
 *
 * Shutdown runs after the guarded run and cannot alter its exit code, so a
 * teardown failure never masks the outcome the operator needs to see.
 *
 * @param config - The importer configuration loaded by the composition root.
 * @param isConfirmed - True when the operator passed `--confirm`.
 * @returns Exit code: 0 on success, 1 when the run could not complete.
 */
export default async function runCardRefundCleanup(
  config: IImporterConfig, isConfirmed: boolean,
): Promise<number> {
  const exitCode = await runGuarded(config, isConfirmed);
  await shutdownQuietly();
  return exitCode;
}
