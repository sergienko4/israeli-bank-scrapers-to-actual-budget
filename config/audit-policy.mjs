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
      + 'shipped, or we patch extraction ourselves as set out in '
      + 'plans/clear-blocking-audit-advisories-adm-zip.md.',
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
    && typeof entry.upstream === 'string' && entry.upstream.length > 0
    && typeof entry.added === 'string' && entry.added.length > 0;
}

/**
 * Reports whether an acceptance window fits inside the permitted cap.
 *
 * An unparseable or inverted date range is treated as out of bounds so a typo
 * fails the build rather than granting an open-ended waiver.
 *
 * @param {object} entry Accepted-advisory entry carrying `added` and `expires`.
 * @returns {boolean} True when the window is positive and within the cap.
 */
function isWithinAcceptanceCap(entry) {
  const added = Date.parse(`${entry.added}T00:00:00Z`);
  const expires = Date.parse(`${entry.expires}T00:00:00Z`);
  if (Number.isNaN(added) || Number.isNaN(expires)) return false;
  const days = (expires - added) / MS_PER_DAY;
  return days > 0 && days <= MAX_PRODUCTION_ACCEPTANCE_DAYS;
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
  const today = new Date().toISOString().slice(0, 10);
  if (!entry) return 'no accepted-advisory entry';
  if (entry.expires <= today) return `exception expired on ${entry.expires}`;
  if (!productionPackages.has(advisory.package)) return null;
  if (!hasProductionEvidence(entry)) {
    return 'reaches the production tree; exception lacks the required evidence';
  }
  if (!isWithinAcceptanceCap(entry)) {
    return `production acceptance must expire within ${MAX_PRODUCTION_ACCEPTANCE_DAYS} days of being added`;
  }
  return null;
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
