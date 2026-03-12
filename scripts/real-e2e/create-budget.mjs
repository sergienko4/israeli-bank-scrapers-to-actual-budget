/**
 * Creates a local test budget for real E2E testing.
 * Same pattern as tests/e2e/e2e-setup.ts — no server needed.
 *
 * Prints BUDGET_ID=<id> to stdout for the workflow to capture.
 */

import api from '@actual-app/api';

try {
  await api.init({ dataDir: '/app/data' });

  const budgetName = `real-e2e-${Date.now()}`;
  await api.runImport(budgetName, () => {});

  const budgets = await api.getBudgets();
  const budget = budgets[0];
  if (!budget) throw new Error('No budgets found after creation');

  await api.shutdown();

  console.log(`BUDGET_ID=${budget.id}`);
} catch (error) {
  console.error('Budget creation failed:', error);
  process.exit(1);
}
