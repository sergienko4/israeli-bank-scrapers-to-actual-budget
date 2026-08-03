/**
 * License compliance enforcement script.
 *
 * Checks:
 * 1. Project license (package.json "license" field) is in the allowed list.
 * 2. Production dependency licenses match the allowed SPDX identifiers.
 *
 * Run via: npm run lint:licenses
 * Included in validate:all and CI to catch violations before commit.
 *
 * license-compliance is used only to enumerate production packages and their
 * declared licenses; the allow-list decision is made by
 * config/license-policy.mjs, which documents why the library's own `--allow`
 * matching is not used.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { ALLOWED_PROJECT_LICENSES, findLicenseViolations } from './license-policy.mjs';

// Resolved through the package's own "exports" map so the gate keeps working
// wherever npm hoists the dependency, and invoked with execFileSync plus an
// argument array (never a shell string) per the repository's CodeQL rules.
const CLI_ENTRY = createRequire(import.meta.url).resolve('license-compliance');

/* ── Gate 1: Project license ──────────────────────────────────────── */

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

if (!ALLOWED_PROJECT_LICENSES.includes(pkg.license)) {
  console.error(
    `❌ Project license "${pkg.license}" is not allowed. Allowed: ${ALLOWED_PROJECT_LICENSES.join(', ')}`,
  );
  process.exit(1);
}

console.log(`✅ Project license: ${pkg.license}`);

/* ── Gate 2: Dependency licenses ──────────────────────────────────── */

/**
 * Enumerates every production dependency with its declared SPDX expression.
 *
 * @returns {Array<{ name: string, version: string, license: string }>} The reported packages.
 */
function readProductionPackages() {
  const stdout = execFileSync(
    process.execPath,
    [CLI_ENTRY, '--production', '--format', 'json', '--report', 'detailed'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  return JSON.parse(stdout);
}

let packages;
try {
  packages = readProductionPackages();
} catch (error) {
  console.error(`❌ Unable to enumerate production dependencies: ${error.message}`);
  process.exit(1);
}

const violations = findLicenseViolations(packages);

if (violations.length > 0) {
  console.error('❌ Dependency license violation detected:');
  for (const violation of violations) {
    console.error(`   • ${violation.name}@${violation.version} — ${violation.license}`);
  }
  process.exit(1);
}

console.log(`✅ All ${packages.length} production dependency licenses are compliant`);
