#!/usr/bin/env node
/**
 * Seeds the local-validation stack's config and credentials.
 *
 * Runs after `npm run test:e2e:setup`, which creates the throwaway budget and
 * writes `tests/e2e/fixtures/config.generated.json`. This script layers a
 * portal block on top of that config so the same stack that runs an import also
 * serves `/api/status` to curl and to the phone app.
 *
 * Everything it writes is a `config.json` / `credentials.json` pair, which
 * `.gitignore` already excludes — the generated stack config never lands in a
 * commit, only the generator does.
 *
 * Usage (from the repository root):
 *   node tests/e2e/local-stack/setup.mjs
 */
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..');
const SOURCE_CONFIG = join(REPO_ROOT, 'tests', 'e2e', 'fixtures', 'config.generated.json');
const DATA_DIR = join(REPO_ROOT, 'tests', 'e2e', 'fixtures', 'e2e-data');
const STACK_DIR = join(HERE, 'stack-config');

/** The password the local portal accepts. Local-only, never a real secret. */
const PORTAL_PASSWORD = 'local-validation';

/**
 * Hashes a portal password with the same scrypt scheme the portal verifies.
 * @param {string} plaintext The password to hash.
 * @returns {string} A `scrypt$<salt>$<derived>` hash string.
 */
function hashPassword(plaintext) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(plaintext, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

/**
 * Builds the portal block that exposes the API to curl and to the phone app.
 *
 * `host` is 0.0.0.0 because the Android emulator reaches the host through
 * 10.0.2.2, which never arrives on the loopback interface.
 * @returns {object} The portal config section.
 */
function portalSection() {
  return {
    enabled: true,
    host: '0.0.0.0',
    port: 8080,
    authMode: 'password',
    app: {
      enabled: true,
      redirectUris: ['bankimporter://auth'],
      accessTokenTtlMinutes: 180,
      refreshTokenTtlDays: 60,
    },
  };
}

/**
 * Finds the budget `npm run test:e2e:setup` created, by its directory name.
 *
 * The setup script prints the id and does not persist it anywhere, but it does
 * leave the budget on disk, so the directory is the record. Repeated setups
 * leave older budgets behind, so the most recently written one wins.
 * @returns {string} The budget id the importer containers should load.
 */
function findBudgetId() {
  const budgets = readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('e2e-test-budget-'))
    .map((entry) => ({ name: entry.name, at: statSync(join(DATA_DIR, entry.name)).mtimeMs }))
    .sort((left, right) => left.at - right.at);
  if (budgets.length === 0) {
    throw new Error(`No e2e budget in ${DATA_DIR}. Run "npm run test:e2e:setup" first.`);
  }
  return budgets[budgets.length - 1].name;
}

/**
 * Writes the stack config and credentials next to this script.
 * @returns {void}
 */
function main() {
  const config = JSON.parse(readFileSync(SOURCE_CONFIG, 'utf8'));
  config.portal = portalSection();

  const credentials = {
    portal: {
      passwordHash: hashPassword(PORTAL_PASSWORD),
      sessionSecret: randomBytes(24).toString('hex'),
    },
  };

  mkdirSync(STACK_DIR, { recursive: true });
  writeFileSync(join(STACK_DIR, 'config.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(STACK_DIR, 'credentials.json'), JSON.stringify(credentials, null, 2));

  const budgetId = findBudgetId();
  writeFileSync(join(HERE, '.env'), `E2E_LOCAL_BUDGET_ID=${budgetId}\n`);

  console.log(`Stack config written to ${STACK_DIR}`);
  console.log(`Budget: ${budgetId}`);
  console.log(`Portal password: ${PORTAL_PASSWORD}`);
}

main();
