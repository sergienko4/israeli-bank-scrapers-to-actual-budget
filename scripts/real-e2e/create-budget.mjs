/**
 * Creates a fresh budget on the Actual Budget server for real E2E testing.
 *
 * Runs inside the importer Docker container (which has @actual-app/api).
 * Prints the budget syncId to stdout for the workflow to capture.
 *
 * Usage:
 *   docker run --rm --network real-e2e-net \
 *     -v /path/to/data:/app/data \
 *     israeli-bank-importer:real-e2e \
 *     node scripts/real-e2e/create-budget.mjs <serverURL> <password>
 *
 * @param {string} serverURL - Actual Budget server URL (e.g., http://actual-server-test:5006)
 * @param {string} password  - Password for the Actual Budget server
 */

import api from '@actual-app/api';

const serverURL = process.argv[2];
const password = process.argv[3];

if (!serverURL || !password) {
  console.error('Usage: node create-budget.mjs <serverURL> <password>');
  process.exit(1);
}

try {
  await api.init({ dataDir: '/app/data', serverURL, password });

  const budgetName = `real-e2e-${Date.now()}`;
  await api.runImport(budgetName, () => {});

  const budgets = await api.getBudgets();
  const budget = budgets[0];
  if (!budget) throw new Error('No budgets found after creation');

  await api.shutdown();

  // Print only the syncId — captured by the workflow via $(...)
  console.log(budget.groupId ?? budget.id);
} catch (error) {
  console.error('Budget creation failed:', error);
  process.exit(1);
}
