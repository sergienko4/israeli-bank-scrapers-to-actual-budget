/**
 * Audit policy for the dependency vulnerability gate.
 *
 * The gate (config/check-audit.mjs) fails on every advisory at or above
 * AUDIT_LEVEL. A small number of advisories cannot be fixed because upstream
 * has not published a patched version our dependency range can accept. Those
 * are listed in ACCEPTED_ADVISORIES with a rationale and a hard expiry.
 *
 * An entry here is deliberately weaker than it looks:
 *   - It only suppresses the named advisory, never a whole severity or scope.
 *   - It stops working on its `expires` date, so a stale exception fails the
 *     build instead of quietly becoming permanent.
 *   - It is ignored entirely if the package reaches the production tree, so an
 *     exception can never hide a vulnerability in the published image.
 *
 * Adding an entry requires evidence that the advisory is genuinely unfixable
 * and unreachable. Prefer upgrading, overriding, or removing the dependency.
 */

/** Severity floor the gate enforces, matching `npm audit --audit-level`. */
export const AUDIT_LEVEL = 'moderate';

/** Severity ordering used to compare an advisory against AUDIT_LEVEL. */
export const SEVERITY_RANK = ['info', 'low', 'moderate', 'high', 'critical'];

/**
 * Advisories accepted until a fix exists upstream.
 *
 * @type {Array<{ ghsa: string, package: string, expires: string, reason: string }>}
 */
export const ACCEPTED_ADVISORIES = [];

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
 * @returns {{ ghsa: string, package: string, expires: string, reason: string } | undefined} The entry.
 */
export function findAcceptedEntry(advisory) {
  return ACCEPTED_ADVISORIES.find(
    entry => entry.ghsa === advisory.ghsa && entry.package === advisory.package,
  );
}

/**
 * Classifies advisories into blocking violations and accepted suppressions.
 *
 * An accepted entry is honoured only when it has not expired and the affected
 * package is absent from the production dependency tree.
 *
 * @param {Array<{ ghsa: string, package: string, severity: string, title: string }>} advisories Advisories found.
 * @param {Set<string>} productionPackages Packages with advisories in the production tree.
 * @returns {{ violations: Array<object>, accepted: Array<object> }} The classification result.
 */
export function classifyAdvisories(advisories, productionPackages) {
  const violations = [];
  const accepted = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const advisory of advisories.filter(a => isInScope(a.severity))) {
    const entry = findAcceptedEntry(advisory);
    if (!entry) {
      violations.push({ ...advisory, why: 'no accepted-advisory entry' });
    } else if (productionPackages.has(advisory.package)) {
      violations.push({ ...advisory, why: 'reaches the production tree; exception does not apply' });
    } else if (entry.expires <= today) {
      violations.push({ ...advisory, why: `exception expired on ${entry.expires}` });
    } else {
      accepted.push({ ...advisory, expires: entry.expires, reason: entry.reason });
    }
  }

  return { violations, accepted };
}
