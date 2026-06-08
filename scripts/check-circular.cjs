/**
 * Circular-dependency gate for src/.
 *
 * Wraps madge programmatically so we can pass detective options the CLI
 * does not expose (specifically `skipTypeImports: true`). TypeScript erases
 * type-only imports at runtime, so a cycle formed only by type-only edges
 * is not a real runtime cycle and must not block commits.
 *
 * Exits 0 when no runtime circular dependency is found in src/.
 * Exits 1 (with summary) when at least one real cycle exists.
 */

'use strict';

const path = require('node:path');
const madge = require('madge');

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'src');

/**
 * Entry point: runs madge programmatically against src/ and decides exit code.
 *
 * @returns {Promise<void>} Resolves before process exits.
 */
async function main() {
  const res = await madge(SRC_DIR, {
    fileExtensions: ['ts'],
    detectiveOptions: {
      ts: { skipTypeImports: true, mixedImports: true },
      tsx: { skipTypeImports: true, mixedImports: true },
    },
  });
  const cycles = res.circular();
  if (cycles.length === 0) {
    console.log('check-circular: no runtime circular dependencies in src/');
    process.exit(0);
  }
  console.error(`check-circular: ${cycles.length} runtime circular dependency(ies) found:`);
  for (const cycle of cycles) {
    console.error(`  ${cycle.join(' > ')}`);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error(`check-circular: scanner failed: ${err.message}`);
  process.exit(2);
});
