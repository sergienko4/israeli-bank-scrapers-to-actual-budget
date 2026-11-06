/**
 * Fixtures for exercising a shipped auto-extending acceptance after its
 * expiry date, without waiting for the calendar to get there.
 *
 * The audit gate and the override planner read the clock through `Date`. The
 * unit suite fakes it with vitest; the child-process suites cannot, so they
 * preload the module {@link writeFrozenClock} writes.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { IAutoExtend } from '../../config/audit-blockers.mjs';
import { ACCEPTED_ADVISORIES, type IAcceptedAdvisory } from '../../config/audit-policy.mjs';

/** A shipped acceptance that opted in to auto-extension. */
export interface IAutoExtendingEntry extends IAcceptedAdvisory {
  /** The opt-in, always present on these entries. */
  autoExtend: IAutoExtend;
}

/**
 * How far past UTC midnight on the expiry date a past-expiry clock sits.
 *
 * A day and a half: the entry is unambiguously expired, and the instant sits
 * mid-day, so no rounding to a date can land it back on the valid side.
 */
export const PAST_EXPIRY_MS = 36 * 60 * 60 * 1000;

/**
 * Returns an instant safely past an acceptance's expiry date.
 *
 * @param expires The entry's `YYYY-MM-DD` expiry date, read as UTC.
 * @returns Epoch milliseconds {@link PAST_EXPIRY_MS} after that midnight.
 */
export function pastExpiryMs(expires: string): number {
  return Date.parse(expires) + PAST_EXPIRY_MS;
}

/**
 * Lists the shipped acceptances that opted in to auto-extension.
 *
 * Suites derive their past-expiry fixtures from this list, so renaming a
 * package or moving its fix version cannot leave one exercising a stale copy.
 * A suite built with `describe.each` over it registers nothing when the list
 * is empty, which is the state after the last opt-in is removed.
 *
 * @returns The entries of `ACCEPTED_ADVISORIES` carrying `autoExtend`, in order.
 */
export function autoExtendingEntries(): IAutoExtendingEntry[] {
  return ACCEPTED_ADVISORIES.filter(
    (entry): entry is IAutoExtendingEntry => entry.autoExtend !== undefined,
  );
}

/**
 * Writes an ES module that freezes `Date` at one instant, for preloading into
 * a child process.
 *
 * Preloading with `--import` replaces `Date` before the CLI's own modules
 * load, so `new Date()` and `Date.now()` both read the frozen instant while an
 * explicit date argument still parses normally.
 *
 * @param dir The scratch directory to write the module into.
 * @param instantMs The frozen instant, in epoch milliseconds.
 * @returns The `node` arguments that preload the module.
 */
export function writeFrozenClock(dir: string, instantMs: number): string[] {
  const file = join(dir, 'freeze-clock.mjs');
  writeFileSync(file, [
    `const FIXED = ${instantMs};`,
    'class FrozenDate extends Date {',
    '  constructor(...args) { if (args.length > 0) super(...args); else super(FIXED); }',
    '  static now() { return FIXED; }',
    '}',
    'globalThis.Date = FrozenDate;',
    '',
  ].join('\n'));
  return ['--import', pathToFileURL(file).href];
}
