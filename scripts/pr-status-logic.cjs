'use strict';

/**
 * Pure verdict logic for the PR Status Watch workflow
 * (.github/workflows/pr-status-watch.yml).
 *
 * Extracted into a standalone module so the combined CI + CodeRabbit status
 * algorithm has a single source of truth that tests/pr-status-logic.test.ts can
 * lock, with zero drift from the workflow (which require()s this file after
 * checkout). No I/O lives here — only deterministic pure functions over the
 * shapes returned by the GitHub GraphQL/REST APIs. Mirrors the
 * scripts/coupling-scanner.cjs + .d.cts + test precedent.
 */

/** Reports whether a check/review name or author login denotes CodeRabbit. */
function isCodeRabbit(name) {
  return (name || '').toLowerCase().includes('coderabbit');
}

/**
 * Resolves the CI verdict from statusCheckRollup contexts, EXCLUDING
 * CodeRabbit's own check run so a CodeRabbit rate-limit or outage (e.g. its
 * "Insufficient usage credits" failure) never reads as a CI failure.
 *
 * @param {Array} contexts rollup context nodes (CheckRun or StatusContext)
 * @returns {'SUCCESS'|'FAILURE'|'PENDING'|'NONE'}
 */
function ciVerdict(contexts) {
  const ci = (contexts || []).filter((c) => c && !isCodeRabbit(c.name || c.context));
  if (ci.length === 0) return 'NONE';
  let pending = false;
  let failed = false;
  for (const c of ci) {
    if (c.__typename === 'CheckRun') {
      if (c.status !== 'COMPLETED') pending = true;
      else if (!['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(c.conclusion)) failed = true;
    } else {
      if (c.state === 'PENDING' || c.state === 'EXPECTED') pending = true;
      else if (c.state === 'ERROR' || c.state === 'FAILURE') failed = true;
    }
  }
  if (failed) return 'FAILURE';
  if (pending) return 'PENDING';
  return 'SUCCESS';
}

/**
 * Resolves the latest CodeRabbit review state from a reviews list, or 'NONE'
 * when CodeRabbit has not reviewed yet. Non-CodeRabbit reviews are ignored.
 *
 * @param {Array} reviews review nodes { author: { login }, state, submittedAt }
 * @returns {string} e.g. 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'NONE'
 */
function crVerdict(reviews) {
  const ts = (r) => {
    const t = Date.parse(r && r.submittedAt);
    return Number.isNaN(t) ? 0 : t;
  };
  const cr = (reviews || [])
    .filter((r) => r && isCodeRabbit(r.author && r.author.login))
    .slice()
    .sort((a, b) => ts(b) - ts(a));
  return cr.length ? cr[0].state : 'NONE';
}

/**
 * Resolves the single maintainer-facing verdict from the CI and CodeRabbit
 * verdicts. A CodeRabbit "changes requested" blocks regardless of CI; a real
 * CI failure blocks regardless of CodeRabbit.
 *
 * @param {string} ci result of {@link ciVerdict}
 * @param {string} cr result of {@link crVerdict}
 * @returns {string} a short emoji-prefixed status line
 */
function overallVerdict(ci, cr) {
  if (ci === 'FAILURE') return '🔴 Blocked — CI failing';
  if (cr === 'CHANGES_REQUESTED') return '🟠 Blocked — CodeRabbit requested changes';
  if (ci === 'PENDING' || ci === 'NONE') return '🟡 Waiting — CI running';
  if (cr === 'NONE') return '🟡 Waiting — CodeRabbit review pending';
  return '🟢 Ready for maintainer — CI green, CodeRabbit reviewed';
}

module.exports = { isCodeRabbit, ciVerdict, crVerdict, overallVerdict };
