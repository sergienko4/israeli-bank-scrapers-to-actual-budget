/**
 * Stage 3: import canonicalized data via AccountImporter.
 *
 * Builds the per-bank IBankResult on success (imported + skipped
 * counts + duration). Stamps STAGE_IMPORT on failure so quarantine
 * labels remain stable across the cluster.
 */

import type { IBankResult, ICanonicalScrapeResult, Procedure } from '../../Index.js';
import { fromPromise, isFail, succeed } from '../../Index.js';
import type { IBankOpts } from './Shared.js';
import { adaptFail, STAGE_IMPORT } from './Shared.js';

/** Imported counts from AccountImporter for one bank. */
interface IImportCounts {
  readonly imported: number;
  readonly skipped: number;
}

/**
 * Imports canonicalized data via AccountImporter and builds the IBankResult.
 * @param opts - Per-bank opts.
 * @param canonical - Canonical scrape result from MapStage.
 * @returns Procedure&lt;IBankResult&gt; stamped STAGE_IMPORT on fail.
 */
export default async function importStage(
  opts: IBankOpts, canonical: ICanonicalScrapeResult,
): Promise<Procedure<IBankResult>> {
  const importPromise = opts.ctx.services.accountImporter
    .processAllAccounts(opts.entry.bankName, opts.entry.bankConfig, canonical);
  const imported = await fromPromise(importPromise, 'Import failed');
  if (isFail(imported)) return adaptFail(imported, STAGE_IMPORT);
  const bankResult = buildBankResult(opts, imported.data);
  return succeed(bankResult);
}

/**
 * Builds the IBankResult for a successfully imported bank.
 * @param opts - Per-bank opts (used for bankName + start timestamp).
 * @param counts - Imported and skipped counts from AccountImporter.
 * @returns Frozen IBankResult.
 */
function buildBankResult(
  opts: IBankOpts, counts: IImportCounts,
): IBankResult {
  return Object.freeze({
    bankName: opts.entry.bankName,
    imported: counts.imported,
    skipped: counts.skipped,
    durationMs: Date.now() - opts.start,
  });
}
