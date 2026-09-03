#!/usr/bin/env node
/**
 * Lockfile canonicality guard and repair tool.
 *
 * `.github/workflows/lockfile-refresh.yml` is what actually refreshes
 * transitive pins: it runs `npm update` on a runner, where npm resolves and
 * verifies each tarball itself. This script is the other half — it proves the
 * committed `package-lock.json` really is what npm produced against the public
 * registry, and repairs the one defect class a maintainer can hit locally.
 *
 * Usage:
 *   node scripts/refresh-lockfile.mjs --check   # audit only, non-zero on drift
 *   node scripts/refresh-lockfile.mjs           # repair registry URLs in place
 *
 * See scripts/refresh-lockfile-logic.mjs for the policy and its rationale.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import {
  auditLockfile,
  canonicalizeRegistryUrls,
  formatLockfileReport,
  formatRepairSummary,
} from './refresh-lockfile-logic.mjs';

const LOCKFILE = new URL('../package-lock.json', import.meta.url);

/**
 * Reports the audit verdict and exits with a CI-meaningful status code.
 *
 * Both modes end here: `--check` judges the file as committed, and the repair
 * mode judges what it just wrote. An integrity downgrade survives the repair
 * by design, so this is also what makes that case exit non-zero.
 *
 * @param {string} lockText The lockfile contents to judge.
 * @returns {never} Always terminates the process.
 */
function reportAndExit(lockText) {
  const audit = auditLockfile(lockText);
  console.log(formatLockfileReport(audit));
  process.exit(audit.ok ? 0 : 1);
}

/**
 * Rewrites mirror-sourced registry URLs in place and reports the outcome.
 *
 * The report names what the rewrite did not prove: the integrity hashes are
 * the mirror's, and only `npm ci` on CI can check them against the real
 * tarball. See INTEGRITY_CAVEAT in the logic module for why regenerating them
 * here would weaken the guarantee rather than strengthen it.
 *
 * @param {string} lockText The lockfile contents to repair.
 * @returns {never} Always terminates the process.
 */
function runRepair(lockText) {
  const { text, replaced } = canonicalizeRegistryUrls(lockText);
  if (replaced > 0) writeFileSync(LOCKFILE, text);
  console.log(formatRepairSummary(replaced));
  reportAndExit(text);
}

let lockText;
try {
  lockText = readFileSync(LOCKFILE, 'utf8');
} catch (error) {
  console.error(`❌ Unable to read package-lock.json: ${error.message}`);
  process.exit(1);
}

if (process.argv.includes('--check')) reportAndExit(lockText);
runRepair(lockText);
