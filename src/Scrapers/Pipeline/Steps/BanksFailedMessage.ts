/**
 * User-facing message for a run in which no configured bank succeeded.
 *
 * The importer spawns one child process per bank, so a run whose single bank
 * failed still trips INV-4 ("all banks failed") and used to notify operators
 * with the bare status token `all-banks-failed`. That token reads as a total
 * outage even when every other bank imported fine in its own process. Naming
 * the banks — and why each failed — keeps the notification truthful at any
 * batch size.
 */

import type { IBankQuarantineEntry, IBankResultsState } from '../Index.js';

/** Maximum failed banks named before the message is elided. */
const LISTED_BANK_CAP = 5;

/** Stand-in reason when a quarantine entry carries an empty error message. */
const UNKNOWN_REASON = 'unknown error';

/**
 * Maximum characters kept from a single failure reason.
 *
 * Scraper errors can carry multi-line stack context. Telegram truncates at
 * 4096 characters, so an unbounded reason from one bank could push the other
 * failed banks out of the message entirely.
 */
const REASON_CAP = 160;

/** Collapses any run of whitespace, including line breaks, to one space. */
const WHITESPACE_RUN = /\s+/g;

/**
 * Flattens a raw error message to a single bounded line.
 * @param raw - Error message recorded on the quarantine entry.
 * @returns Single-line reason, truncated with an ellipsis when over the cap.
 */
function condenseReason(raw: string): string {
  const flat = raw.replace(WHITESPACE_RUN, ' ').trim();
  if (flat === '') return UNKNOWN_REASON;
  if (flat.length <= REASON_CAP) return flat;
  return `${flat.slice(0, REASON_CAP).trimEnd()}…`;
}

/**
 * Renders one quarantined bank as a `name: reason` fragment.
 * @param entry - Quarantine entry recorded for the failed bank.
 * @returns Single-line description of the bank and its failure reason.
 */
function describeBank(entry: IBankQuarantineEntry): string {
  const reason = condenseReason(entry.error.message);
  return `${entry.bankName}: ${reason}`;
}

/**
 * Appends an elision marker when the cap hid some failed banks.
 * @param listed - Bank descriptions kept after applying the cap.
 * @param hidden - Number of failed banks the cap left out.
 * @returns The listed descriptions plus an elision marker when needed.
 */
function withElision(listed: readonly string[], hidden: number): readonly string[] {
  if (hidden <= 0) return listed;
  return [...listed, `...and ${String(hidden)} more`];
}

/**
 * Describes every failed bank, capped so the notification stays readable.
 * @param quarantined - Quarantine entries recorded during the run.
 * @returns Semicolon-joined description, or an empty string when none exist.
 */
function describeBanks(quarantined: readonly IBankQuarantineEntry[]): string {
  const capped = quarantined.slice(0, LISTED_BANK_CAP);
  const listed = capped.map(describeBank);
  const withMore = withElision(listed, quarantined.length - listed.length);
  return withMore.join('; ');
}

/**
 * Builds the message for a run whose only configured bank failed.
 * @param detail - Description of the failed banks, possibly empty.
 * @returns Message naming the single bank that failed.
 */
function singleBankMessage(detail: string): string {
  if (detail === '') return 'Import failed for the only configured bank';
  return `Import failed for ${detail}`;
}

/**
 * Builds the message for a run in which every one of several banks failed.
 * @param detail - Description of the failed banks, possibly empty.
 * @param total - Number of banks attempted during the run.
 * @returns Message stating how many banks failed and which ones.
 */
function everyBankMessage(detail: string, total: number): string {
  const headline = `All ${String(total)} banks failed`;
  if (detail === '') return headline;
  return `${headline} — ${detail}`;
}

/**
 * Builds the pipeline failure message for a run with zero successful banks.
 * @param partition - Bank partition assembled by the bank-iteration loop.
 * @returns Message naming the failed bank(s) and, when known, why each failed.
 */
export default function buildBanksFailedMessage(partition: IBankResultsState): string {
  const detail = describeBanks(partition.quarantined);
  if (partition.totalBanks === 1) return singleBankMessage(detail);
  return everyBankMessage(detail, partition.totalBanks);
}
