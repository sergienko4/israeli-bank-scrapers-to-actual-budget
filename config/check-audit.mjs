/**
 * Dependency vulnerability enforcement script.
 *
 * Replaces a bare `npm audit --audit-level=moderate` so a single unfixable
 * advisory cannot block every release while still failing on everything else.
 *
 * Checks:
 * 1. Every advisory at or above the enforced severity is either fixed or
 *    covered by an unexpired entry in config/audit-policy.mjs.
 * 2. Any accepted entry covering a package that reaches the production tree
 *    carries explicit evidence and expires inside a short, capped window.
 *
 * Exit codes: 0 when clean, 1 on policy violations, 2 when npm could not
 * produce a report (unparseable output, an npm `error` object, a spawn
 * failure). Callers that act on a red audit treat only 1 as a finding, so a
 * registry outage never triggers remediation.
 *
 * Run via: npm run audit
 */

import { AUDIT_LEVEL, classifyAdvisories } from './audit-policy.mjs';
import { auditCommittedTree } from './audit-report.mjs';

/** Exit code for an audit that ran but found unaddressed advisories. */
const EXIT_VIOLATIONS = 1;

/** Exit code for an audit that could not run, so nothing was judged. */
const EXIT_OPERATIONAL = 2;

/**
 * Audits the committed tree, failing operationally when npm cannot report.
 *
 * @returns {import('./audit-report.d.mts').ICommittedTreeAudit} Both audit views.
 */
function auditOrExit() {
  try {
    return auditCommittedTree();
  } catch (error) {
    console.error(`❌ npm audit could not produce a report: ${error instanceof Error ? error.message : String(error)}`);
    return process.exit(EXIT_OPERATIONAL);
  }
}

const { advisories, productionPackages } = auditOrExit();
const { violations, accepted } = classifyAdvisories(advisories, productionPackages);

for (const entry of accepted) {
  console.log(`⚠️  Accepted ${entry.ghsa} (${entry.package}, ${entry.severity}) until ${entry.expires}`);
  console.log(`    ${entry.reason}`);
}

if (violations.length > 0) {
  console.error(`❌ ${violations.length} unaddressed advisory(ies) at or above "${AUDIT_LEVEL}":`);
  for (const violation of violations) {
    console.error(`  - ${violation.ghsa} ${violation.package} (${violation.severity}) — ${violation.why}`);
    console.error(`    ${violation.title}`);
  }
  console.error('Fix them, or add a justified entry to config/audit-policy.mjs.');
  process.exit(EXIT_VIOLATIONS);
}

console.log(`✅ No unaddressed advisories at or above "${AUDIT_LEVEL}" (${accepted.length} accepted).`);
