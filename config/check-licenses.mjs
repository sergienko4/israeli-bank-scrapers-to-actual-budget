/**
 * License compliance enforcement script.
 *
 * Checks:
 * 1. Project license (package.json "license" field) is in the allowed list.
 * 2. Production dependency licenses match the allowed SPDX identifiers.
 *
 * Run via: npm run lint:licenses
 * Included in validate:all and CI to catch violations before commit.
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/* ── Allowed licenses ─────────────────────────────────────────────── */

const ALLOWED_PROJECT_LICENSES = ['MIT'];

const ALLOWED_DEPENDENCY_LICENSES = [
  'MIT',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'CC-BY-4.0',
  'Python-2.0',
  'MPL-2.0',
  'AGPL-3.0-or-later',
  '(MIT OR WTFPL)',
  '(BSD-3-Clause AND Apache-2.0)',
  '(BSD-2-Clause OR MIT OR Apache-2.0)',
  'Unlicense',
];

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

const allowArg = ALLOWED_DEPENDENCY_LICENSES.join(';');

try {
  execSync(`npx license-compliance --production --allow "${allowArg}"`, {
    stdio: 'inherit',
  });
  console.log('✅ All dependency licenses are compliant');
} catch {
  console.error('❌ Dependency license violation detected (see above)');
  process.exit(1);
}
