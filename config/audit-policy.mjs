/**
 * Audit policy for the dependency vulnerability gate.
 *
 * The gate (config/check-audit.mjs) fails on every advisory at or above
 * AUDIT_LEVEL. ACCEPTED_ADVISORIES lists the advisories the build does not stop
 * on, each with a rationale and a hard expiry.
 *
 * Entries come in two classes, and they do not mean the same thing.
 *
 * A development-tree entry is a deferral. The package never reaches the
 * published image, so the entry withholds a build failure, not a fix.
 *
 * A production-tree entry is an accepted risk: the vulnerability ships to
 * users. Because that is a materially worse thing to do quietly, such an entry
 * is honoured only when it admits reaching production (`productionReachable`),
 * states that no upstream fix exists (`noUpstreamFix`), links the upstream work
 * so that claim can be re-checked (`upstream`), and records when the clock
 * started (`added`). Its window may not exceed MAX_PRODUCTION_ACCEPTANCE_DAYS,
 * so it expires into a build failure long before it can be forgotten. It
 * suppresses only the named advisory, never a severity or a scope.
 *
 * Both classes stop working on their `expires` date, with one narrow exception.
 * A development-tree entry may opt into `autoExtend: { fixedIn }`. It then keeps
 * working past `expires` for as long as some package in the committed lockfile
 * declares a range for the vulnerable package that cannot reach `fixedIn`
 * (config/audit-blockers.mjs finds them). Once nothing blocks the fix, the
 * expired entry fails the build like any other. A production-tree entry can
 * never auto-extend.
 *
 * Prefer upgrading, overriding, or removing the dependency over writing any
 * entry at all.
 */

import { BLOCKERS, parseTriple, resolveAutoExtensions } from './audit-blockers.mjs';

/** Severity floor the gate enforces, matching `npm audit --audit-level`. */
export const AUDIT_LEVEL = 'moderate';

/** Severity ordering used to compare an advisory against AUDIT_LEVEL. */
export const SEVERITY_RANK = ['info', 'low', 'moderate', 'high', 'critical'];

/**
 * Longest window a production-reachable acceptance may cover, in days.
 *
 * Short enough that renewing one is a deliberate act with a fresh review, not
 * a thing that happens by nobody noticing.
 */
export const MAX_PRODUCTION_ACCEPTANCE_DAYS = 30;

/**
 * How many days before its expiry an acceptance starts to warn.
 *
 * Three weeks spans a weekly dependency cycle plus review time, so the warning
 * arrives while the advisory can still be fixed rather than renewed in a hurry.
 */
export const EXPIRY_WARNING_DAYS = 21;

/** Milliseconds in a day, used to measure an acceptance window. */
const MS_PER_DAY = 86_400_000;

/**
 * Advisories the gate does not block on.
 *
 * @type {Array<{ ghsa: string, package: string, expires: string, reason: string,
 *   added?: string, productionReachable?: boolean, noUpstreamFix?: boolean,
 *   upstream?: string, autoExtend?: { fixedIn: string } }>}
 */
export const ACCEPTED_ADVISORIES = [
  {
    ghsa: 'GHSA-g3hv-75wg-m249',
    package: 'minimatch',
    expires: '2027-01-29',
    reason:
      'Dev-only: the remaining minimatch 10.2.6 copies sit under eslint, '
      + '@eslint/config-array, typescript-estree, eslint-plugin-import-x, '
      + 'eslint-plugin-sonarjs and typedoc, and none of them reaches the '
      + 'published image. The production tree is fixed through the glob '
      + 'override, because glob 14 depends on minimatch 11. The advisory is '
      + 'patched only in minimatch 11.0.1, and minimatch 11 removes makeRe, '
      + 'which eslint-plugin-import-x 4.17.1 imports in no-internal-modules, '
      + 'and makes matchOne private, which typedoc 0.28.20 calls in node-utils, so '
      + 'a global override would break npm run lint and npm run docs. The '
      + 'attack needs a hostile glob pattern, and every pattern these tools '
      + 'match is written in this repository. At expiry either import-x and '
      + 'typedoc support minimatch 11 and we take the bump, or these paths '
      + 'are re-checked before renewing.',
  },
];

/**
 * Reports whether a severity meets or exceeds the enforced floor.
 *
 * An unrecognized severity is treated as in scope so a report format change
 * cannot silently drop an advisory from the gate.
 *
 * @param {string} severity Advisory severity as reported by npm audit.
 * @returns {boolean} True when the advisory is in scope for the gate.
 */
export function isInScope(severity) {
  const rank = SEVERITY_RANK.indexOf(severity);
  if (rank === -1) return true;
  return rank >= SEVERITY_RANK.indexOf(AUDIT_LEVEL);
}

/**
 * Finds the accepted-advisory entry covering a given advisory, if any.
 *
 * @param {{ ghsa: string, package: string }} advisory The advisory to match.
 * @param {Array<object>} [entries] Entries to search, defaulting to the policy.
 * @returns {object | undefined} The matching entry.
 */
export function findAcceptedEntry(advisory, entries = ACCEPTED_ADVISORIES) {
  return entries.find(
    entry => entry.ghsa === advisory.ghsa && entry.package === advisory.package,
  );
}

/**
 * Parses a strict `YYYY-MM-DD` calendar date into epoch milliseconds.
 *
 * `Date.parse` alone is too permissive for policy dates: it rolls `2026-02-31`
 * forward into March rather than rejecting it, and it accepts nothing at all
 * for a missing field. Both would let a typo widen a waiver instead of failing
 * the build, so the value must round-trip back to the exact day it claims.
 *
 * @param {unknown} value Candidate date string.
 * @returns {number | null} Epoch milliseconds at UTC midnight, or null when invalid.
 */
function parseIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed)) return null;
  if (new Date(parsed).toISOString().slice(0, 10) !== value) return null;
  return parsed;
}

/**
 * Reports whether a value is a well-formed HTTPS URL.
 *
 * The upstream field exists so a reviewer can follow the tracking issue. A
 * placeholder such as `pending` satisfies "non-empty" while giving a reviewer
 * nothing to open, so the contract asks for a link that actually resolves.
 *
 * @param {unknown} value Candidate URL.
 * @returns {boolean} True when the value parses as an HTTPS URL.
 */
function isHttpsUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Reports whether an entry carries the evidence a production acceptance needs.
 *
 * Accepting a production-tree advisory means shipping a known vulnerability, so
 * the entry has to say so in fields a reviewer can check, rather than in prose
 * nobody re-reads.
 *
 * @param {object} entry Accepted-advisory entry to inspect.
 * @returns {boolean} True when every required field is present.
 */
function hasProductionEvidence(entry) {
  return entry.productionReachable === true
    && entry.noUpstreamFix === true
    && isHttpsUrl(entry.upstream)
    && parseIsoDate(entry.added) !== null;
}

/**
 * Reports whether an acceptance window fits inside the permitted cap.
 *
 * The window is measured from `added`, so an entry dated in the future would
 * otherwise buy more than the cap allows: adding a window that opens next week
 * pushes the expiry beyond 30 days from today while still measuring 30 days
 * wide. Back-dating is harmless, so only future dates are refused.
 *
 * @param {object} entry Accepted-advisory entry carrying `added` and `expires`.
 * @param {number} todayMs Epoch milliseconds for today at UTC midnight.
 * @returns {boolean} True when the window is positive, current, and within the cap.
 */
function isWithinAcceptanceCap(entry, todayMs) {
  const added = parseIsoDate(entry.added);
  const expires = parseIsoDate(entry.expires);
  if (added === null || expires === null) return false;
  if (added > todayMs) return false;
  const days = (expires - added) / MS_PER_DAY;
  return days > 0 && days <= MAX_PRODUCTION_ACCEPTANCE_DAYS;
}

/**
 * Reads today's date as epoch milliseconds at UTC midnight.
 *
 * Read once per run and passed down, so a run that crosses UTC midnight never
 * judges two entries against different days.
 *
 * @returns {number} Epoch milliseconds for today at UTC midnight.
 */
function todayUtcMs() {
  return parseIsoDate(new Date().toISOString().slice(0, 10));
}

/**
 * Reports whether an entry opts into auto-extension, validly or not.
 *
 * Presence of the key alone decides, so a malformed `autoExtend`, even an
 * explicit `undefined`, is held to the auto-extension rules and rejected
 * rather than quietly read as absent.
 *
 * @param {object} entry Accepted-advisory entry under consideration.
 * @returns {boolean} True when the entry has its own `autoExtend` key.
 */
function hasAutoExtend(entry) {
  return Object.hasOwn(entry, 'autoExtend');
}

/**
 * Reports whether an entry opts into auto-extension without a usable fixed version.
 *
 * @param {object} entry Accepted-advisory entry under consideration.
 * @returns {boolean} True when `autoExtend.fixedIn` is not a plain `MAJOR.MINOR.PATCH`.
 */
function hasInvalidAutoExtend(entry) {
  return hasAutoExtend(entry) && parseTriple(entry.autoExtend?.fixedIn) === null;
}

/**
 * Reads the locked packages that block an entry's fix, as resolution recorded them.
 *
 * @param {object} entry Accepted-advisory entry, possibly resolved.
 * @returns {Array<string>} The blockers, or an empty list when none were recorded.
 */
function blockersOf(entry) {
  const blockers = entry[BLOCKERS];
  return Array.isArray(blockers) ? blockers : [];
}

/**
 * Reports whether an auto-extending entry is still blocked from taking its fix.
 *
 * The blockers are read from the BLOCKERS symbol, which only
 * resolveAutoExtensions writes. Neither a `blockers` field in the policy data
 * nor a caller that skipped resolution can therefore extend an entry: both
 * read as "not blocked", which fails closed into an ordinary expiry.
 *
 * @param {object} entry Accepted-advisory entry, possibly resolved.
 * @returns {boolean} True when the entry opts in and at least one locked package blocks the fix.
 */
function isStillBlocked(entry) {
  return parseTriple(entry.autoExtend?.fixedIn) !== null && blockersOf(entry).length > 0;
}

/**
 * Explains an expiry, naming the missing blocker for an auto-extending entry.
 *
 * @param {object} entry The expired entry.
 * @returns {string} The blocking reason.
 */
function expiredReason(entry) {
  const expired = `exception expired on ${entry.expires}`;
  if (!hasAutoExtend(entry)) return expired;
  return `${expired}; it auto-extends only while a locked package blocks ${entry.package} ${entry.autoExtend.fixedIn}, and none does`;
}

/**
 * Reports why an entry cannot be honoured regardless of which tree it sits in.
 *
 * Every acceptance must carry a rationale. The type allows the field to be
 * absent so malformed input can be classified rather than crash, which means
 * the runtime has to reject it here; otherwise a waiver with no justification
 * is honoured and `check-audit.mjs` reports `undefined` as its reason.
 *
 * An expired entry stands only when it auto-extends and a locked package still
 * blocks its fix.
 *
 * @param {object} entry Accepted-advisory entry under consideration.
 * @param {number} todayMs Epoch milliseconds for today at UTC midnight.
 * @returns {string | null} The blocking reason, or null when the entry stands.
 */
function universalBlockingReason(entry, todayMs) {
  if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
    return 'exception has no rationale';
  }
  const expiresMs = parseIsoDate(entry.expires);
  if (expiresMs === null) return 'exception has an invalid expires date';
  if (hasInvalidAutoExtend(entry)) return 'exception has an invalid autoExtend.fixedIn version';
  if (expiresMs <= todayMs && !isStillBlocked(entry)) return expiredReason(entry);
  return null;
}

/**
 * Reports why an entry fails the stricter bar applied to the production tree.
 *
 * An auto-extending entry is refused outright. Shipping a known vulnerability
 * has to stay capped and dated, so it can never run on past its expiry.
 *
 * @param {object} entry Accepted-advisory entry under consideration.
 * @param {number} todayMs Epoch milliseconds for today at UTC midnight.
 * @returns {string | null} The blocking reason, or null when the entry stands.
 */
function productionBlockingReason(entry, todayMs) {
  if (hasAutoExtend(entry)) {
    return 'reaches the production tree; an auto-extending exception is development-only';
  }
  if (!hasProductionEvidence(entry)) {
    return 'reaches the production tree; exception lacks the required evidence';
  }
  if (!isWithinAcceptanceCap(entry, todayMs)) {
    return `production acceptance must start today or earlier and expire within ${MAX_PRODUCTION_ACCEPTANCE_DAYS} days of being added`;
  }
  return null;
}

/**
 * Explains why an advisory blocks the build, or reports that it is accepted.
 *
 * The policy date arrives from the caller rather than being read here, so every
 * advisory in one run is judged against the same day. Reading the clock per
 * advisory let a run that crossed UTC midnight accept one entry and reject an
 * identical one as expired.
 *
 * @param {{ package: string }} advisory Advisory under consideration.
 * @param {object | undefined} entry Matching accepted-advisory entry, if any.
 * @param {{ productionPackages: Set<string>, todayMs: number }} policy Run-wide
 *   classification context: the production tree and the policy date in epoch
 *   milliseconds at UTC midnight.
 * @returns {string | null} The blocking reason, or null when accepted.
 */
function blockingReason(advisory, entry, policy) {
  if (!entry) return 'no accepted-advisory entry';
  const universal = universalBlockingReason(entry, policy.todayMs);
  if (universal !== null) return universal;
  if (!policy.productionPackages.has(advisory.package)) return null;
  return productionBlockingReason(entry, policy.todayMs);
}

/**
 * Builds the record reported for an advisory that an entry accepts.
 *
 * An ordinary entry keeps the exact record shape callers have always read. An
 * auto-extending entry also reports its fixed version, the locked packages
 * that block it, and whether it is already running past its expiry, so the
 * gate can warn about every extension it grants.
 *
 * @param {object} advisory Advisory the entry accepts.
 * @param {object} entry The accepting entry, possibly resolved.
 * @param {number} todayMs Epoch milliseconds for today at UTC midnight.
 * @returns {object} The accepted record.
 */
function acceptedRecord(advisory, entry, todayMs) {
  const record = { ...advisory, expires: entry.expires, reason: entry.reason };
  if (!hasAutoExtend(entry)) return record;
  return {
    ...record,
    fixedIn: entry.autoExtend.fixedIn,
    blockers: [...blockersOf(entry)],
    extended: parseIsoDate(entry.expires) <= todayMs,
  };
}

/**
 * Classifies advisories into blocking violations and accepted suppressions.
 *
 * An entry is honoured only when it has not expired, and, when the package
 * reaches the production tree, only when it carries production evidence and a
 * window within MAX_PRODUCTION_ACCEPTANCE_DAYS. An expired development-tree
 * entry also stands when it auto-extends and its resolved blockers are not
 * empty; entries that were never resolved have no blockers, so they expire.
 *
 * The policy date is read once here and reused for every advisory, so a run
 * that crosses UTC midnight cannot judge two entries against different days.
 *
 * @param {Array<{ ghsa: string, package: string, severity: string, title: string }>} advisories Advisories found.
 * @param {Set<string>} productionPackages Packages with advisories in the production tree.
 * @param {Array<object>} [entries] Entries to apply, defaulting to the policy.
 * @returns {{ violations: Array<object>, accepted: Array<object> }} The classification result.
 */
export function classifyAdvisories(advisories, productionPackages, entries = ACCEPTED_ADVISORIES) {
  const violations = [];
  const accepted = [];
  const policy = { productionPackages, todayMs: todayUtcMs() };

  for (const advisory of advisories.filter(a => isInScope(a.severity))) {
    const entry = findAcceptedEntry(advisory, entries);
    const why = blockingReason(advisory, entry, policy);
    if (why) {
      violations.push({ ...advisory, why });
    } else {
      accepted.push(acceptedRecord(advisory, entry, policy.todayMs));
    }
  }

  return { violations, accepted };
}

/**
 * Classifies a committed-tree audit after resolving auto-extensions from the lockfile.
 *
 * This is the entry point the gates use. Resolving and classifying in one call
 * means no caller can judge an auto-extending entry against blockers from a
 * different lockfile or audit, or forget to resolve it and lose the extension.
 * The audit's advisory ranges decide which locked copies are still affected.
 *
 * @param {{ advisories: Array<object>, productionPackages: Set<string> }} audit The committed-tree audit.
 * @param {Record<string, object>} lockPackages The committed lockfile's `packages` map.
 * @param {Array<object>} [entries] Entries to apply, defaulting to the policy.
 * @returns {{ violations: Array<object>, accepted: Array<object>, resolvedEntries: Array<object> }}
 *   The classification, plus the resolved entries for the follow-up warnings.
 */
export function classifyCommittedAudit(audit, lockPackages, entries = ACCEPTED_ADVISORIES) {
  const resolvedEntries = resolveAutoExtensions(entries, lockPackages, audit.advisories);
  const result = classifyAdvisories(audit.advisories, audit.productionPackages, resolvedEntries);
  return { ...result, resolvedEntries };
}

/**
 * Counts the days from today until an ISO date.
 *
 * @param {unknown} isoDate Candidate `YYYY-MM-DD` date.
 * @param {number} todayMs Epoch milliseconds for today at UTC midnight.
 * @returns {number | null} Whole days until the date, or null when it is invalid.
 */
function daysUntil(isoDate, todayMs) {
  const dateMs = parseIsoDate(isoDate);
  return dateMs === null ? null : (dateMs - todayMs) / MS_PER_DAY;
}

/**
 * Lists the acceptances that lapse within the warning window.
 *
 * An auto-extending entry whose fix is still blocked is left out, because it
 * will not lapse on its date; once past it, the entry reports as extended
 * instead. An entry with an invalid date is left out too, because the gate
 * already rejects it.
 *
 * @param {Array<object>} [entries] Entries to inspect, defaulting to the policy.
 * @param {number} [days] Width of the warning window in days.
 * @returns {Array<object>} Entries that expire after today and at most `days` days from now.
 */
export function expiringSoon(entries = ACCEPTED_ADVISORIES, days = EXPIRY_WARNING_DAYS) {
  const todayMs = todayUtcMs();
  return entries.filter((entry) => {
    if (isStillBlocked(entry)) return false;
    const daysLeft = daysUntil(entry.expires, todayMs);
    return daysLeft !== null && daysLeft > 0 && daysLeft <= days;
  });
}

/**
 * Lists the entries that match no advisory the audit reported.
 *
 * An entry has outlived its purpose once npm audit stops reporting its
 * advisory, whether the fix landed or the advisory was withdrawn. Advisories of
 * every severity count as a match, so an entry is not called unused merely
 * because its advisory sits below the gate's floor.
 *
 * @param {Array<{ ghsa: string, package: string }>} entries Entries to inspect.
 * @param {Array<{ ghsa: string, package: string }>} advisories Advisories reported, at any severity.
 * @returns {Array<object>} Entries with no matching advisory.
 */
export function unusedEntries(entries, advisories) {
  return entries.filter(entry => !advisories.some(
    advisory => advisory.ghsa === entry.ghsa && advisory.package === entry.package,
  ));
}
