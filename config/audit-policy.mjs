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
 * Both classes stop working on their `expires` date. Prefer upgrading,
 * overriding, or removing the dependency over writing either one.
 */

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

/** Milliseconds in a day, used to measure an acceptance window. */
const MS_PER_DAY = 86_400_000;

/**
 * Advisories the gate does not block on.
 *
 * @type {Array<{ ghsa: string, package: string, expires: string, reason: string,
 *   added?: string, productionReachable?: boolean, noUpstreamFix?: boolean,
 *   upstream?: string }>}
 */
export const ACCEPTED_ADVISORIES = [
  {
    ghsa: 'GHSA-vwc7-r8mq-g2x9',
    package: 'adm-zip',
    added: '2026-09-10',
    expires: '2026-10-10',
    productionReachable: true,
    noUpstreamFix: true,
    upstream: 'https://github.com/cthackers/adm-zip/issues/574',
    reason:
      'Reaches production through @sergienko4/israeli-bank-scrapers -> '
      + '@hieutran094/camoufox-js, which unpacks the Camoufox browser and its '
      + 'addons with adm-zip. Both extraction paths do run, so this is an '
      + 'accepted risk rather than an unreachable one; what makes a short '
      + 'window tolerable is that the archives come from TLS-verified GitHub '
      + 'releases, not that the code is unreachable. 0.6.0 is the newest '
      + 'release and is unpatched, downgrading trades this moderate advisory '
      + 'for the high GHSA-xcpc-8h2w-3j85, and generative-bayesian-network '
      + 'requires ^0.6.0, so no version in range is clean. Upstream fixes are '
      + 'open but unmerged (PRs 575 and 576). At expiry either upstream has '
      + 'shipped and we take the bump, or we vendor a patched extraction path '
      + 'that resolves each entry against the destination root and skips any '
      + 'entry that escapes it.',
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
 * Reports why an entry cannot be honoured regardless of which tree it sits in.
 *
 * Every acceptance must carry a rationale. The type allows the field to be
 * absent so malformed input can be classified rather than crash, which means
 * the runtime has to reject it here; otherwise a waiver with no justification
 * is honoured and `check-audit.mjs` reports `undefined` as its reason.
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
  if (expiresMs <= todayMs) return `exception expired on ${entry.expires}`;
  return null;
}

/**
 * Reports why an entry fails the stricter bar applied to the production tree.
 *
 * @param {object} entry Accepted-advisory entry under consideration.
 * @param {number} todayMs Epoch milliseconds for today at UTC midnight.
 * @returns {string | null} The blocking reason, or null when the entry stands.
 */
function productionBlockingReason(entry, todayMs) {
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
 * @param {{ package: string }} advisory Advisory under consideration.
 * @param {Set<string>} productionPackages Packages present in the production tree.
 * @param {object | undefined} entry Matching accepted-advisory entry, if any.
 * @returns {string | null} The blocking reason, or null when accepted.
 */
function blockingReason(advisory, productionPackages, entry) {
  const todayMs = parseIsoDate(new Date().toISOString().slice(0, 10));
  if (!entry) return 'no accepted-advisory entry';
  const universal = universalBlockingReason(entry, todayMs);
  if (universal !== null) return universal;
  if (!productionPackages.has(advisory.package)) return null;
  return productionBlockingReason(entry, todayMs);
}

/**
 * Classifies advisories into blocking violations and accepted suppressions.
 *
 * An entry is honoured only when it has not expired, and, when the package
 * reaches the production tree, only when it carries production evidence and a
 * window within MAX_PRODUCTION_ACCEPTANCE_DAYS.
 *
 * @param {Array<{ ghsa: string, package: string, severity: string, title: string }>} advisories Advisories found.
 * @param {Set<string>} productionPackages Packages with advisories in the production tree.
 * @param {Array<object>} [entries] Entries to apply, defaulting to the policy.
 * @returns {{ violations: Array<object>, accepted: Array<object> }} The classification result.
 */
export function classifyAdvisories(advisories, productionPackages, entries = ACCEPTED_ADVISORIES) {
  const violations = [];
  const accepted = [];

  for (const advisory of advisories.filter(a => isInScope(a.severity))) {
    const entry = findAcceptedEntry(advisory, entries);
    const why = blockingReason(advisory, productionPackages, entry);
    if (why) {
      violations.push({ ...advisory, why });
    } else {
      accepted.push({ ...advisory, expires: entry.expires, reason: entry.reason });
    }
  }

  return { violations, accepted };
}
