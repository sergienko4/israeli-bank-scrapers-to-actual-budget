#!/usr/bin/env node
/**
 * Docker build + browser smoke gate.
 *
 * Replaces the inline bash in `.husky/pre-commit` gate 10:
 *   1. Remove any local `israeli-bank-importer:pre-commit` image and
 *      prune dangling layers (force-fresh build, mirrors CI).
 *   2. `docker build --no-cache -t israeli-bank-importer:pre-commit .`
 *   3. Smoke test: launch the scraper with Camoufox, terminate cleanly.
 *
 * Exits 0 on success, 1 on any failure (and prints the failing step's
 * tail so callers see the cause without re-running).
 */

import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';

const IMAGE_TAG = 'israeli-bank-importer:pre-commit';
const SMOKE_SCRIPT = `
  import { createScraper } from '@sergienko4/israeli-bank-scrapers';
  const s = createScraper({ companyId: 'hapoalim', startDate: new Date() });
  await s.initialize();
  await s.terminate(true);
  console.log('Browser smoke test passed');
`.trim();

/**
 * Runs a child process inheriting stdio. Resolves with exit code.
 *
 * @param {string} cmd
 * @param {ReadonlyArray<string>} args
 * @returns {Promise<number>}
 */
async function exec(cmd, args) {
  return await new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: false });
    child.once('exit', (code) => resolve(code ?? 1));
    child.once('error', () => resolve(1));
  });
}

/**
 * Best-effort cleanup; ignores all errors so partial state never blocks a build.
 *
 * @returns {void}
 */
function pruneStaleImages() {
  spawnSync('docker', ['rmi', '-f', IMAGE_TAG, 'israeli-bank-importer-importer:latest'], {
    stdio: 'ignore',
    shell: false,
  });
  spawnSync('docker', ['image', 'prune', '-f'], { stdio: 'ignore', shell: false });
}

/**
 * Entry point.
 */
async function main() {
  process.stdout.write('Pruning stale importer images...\n');
  pruneStaleImages();

  process.stdout.write('Building Docker image (no cache)...\n');
  const buildCode = await exec('docker', ['build', '--no-cache', '-t', IMAGE_TAG, '.']);
  if (buildCode !== 0) {
    process.stderr.write(`docker build failed with exit code ${buildCode}\n`);
    process.exit(1);
  }

  process.stdout.write('Browser smoke test...\n');
  const smokeCode = await exec('docker', [
    'run', '--rm', '--cap-add', 'SYS_ADMIN',
    IMAGE_TAG,
    'node', '--input-type=module', '-e', SMOKE_SCRIPT,
  ]);
  if (smokeCode !== 0) {
    process.stderr.write(`browser smoke test failed with exit code ${smokeCode}\n`);
    process.exit(1);
  }

  process.stdout.write('Docker image gate passed\n');
  process.exit(0);
}

await main();
