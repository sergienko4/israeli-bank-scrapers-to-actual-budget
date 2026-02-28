/**
 * Enforcement script: detects config files that have been placed at root
 * instead of inside the config/ directory.
 *
 * Run via: npm run lint:config-structure
 * Included in validate:all to catch violations before commit.
 */

import { existsSync } from 'fs';

const MUST_LIVE_IN_CONFIG = [
  'vitest.config.ts',
  'vitest.config.e2e.ts',
  '.markdownlint.jsonc',
  '.markdownlint-cli2.jsonc',
  '.markdownlintignore',
  '.lycheeignore',
  'release-please-config.json',
  '.release-please-manifest.json',
];

const stray = MUST_LIVE_IN_CONFIG.filter(f => existsSync(f));

if (stray.length > 0) {
  console.error('❌ These config files must live in config/:', stray.join(', '));
  process.exit(1);
}

console.log('✅ Config structure is correct');
