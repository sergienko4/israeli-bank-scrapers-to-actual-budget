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
 * 3. An expired development-tree entry that opts into `autoExtend` keeps
 *    working only while package-lock.json still holds a package that cannot
 *    take the fixed version.
 *
 * It also prints `::warning::` lines for an acceptance running past its
 * expiry, one about to lapse, and one whose advisory npm audit no longer
 * reports. The warnings never change the exit code.
 *
 * Exit codes: 0 when clean, 1 on policy violations, 2 when npm could not
 * produce a report (unparseable output, an npm `error` object, a spawn
 * failure). Callers that act on a red audit treat only 1 as a finding, so a
 * registry outage never triggers remediation.
 *
 * Run via: npm run audit
 */

import { AUDIT_LEVEL, auditWarnings, classifyCommittedAudit } from './audit-policy.mjs';
import { auditCommittedTree, readLockPackages } from './audit-report.mjs';

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

const audit = auditOrExit();
// Kept outside auditOrExit's try: a classification error is a bug, so it must
// exit 1 like a finding, never pass for exit 2, which some callers only warn on.
const classification = classifyCommittedAudit(audit, readLockPackages());
const { violations, accepted } = classification;

for (const entry of accepted) {
  const window = entry.extended ? `past ${entry.expires} (auto-extended)` : `until ${entry.expires}`;
  console.log(`⚠️  Accepted ${entry.ghsa} (${entry.package}, ${entry.severity}) ${window}`);
  console.log(`    ${entry.reason}`);
}

for (const warning of auditWarnings(classification, audit.advisories)) console.log(warning);

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
