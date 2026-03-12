/**
 * Verifies that the real E2E import succeeded.
 *
 * Runs inside the importer Docker container (which has @actual-app/api).
 * Connects to the Actual Budget server, loads the budget, and checks
 * that accounts and transactions were created.
 *
 * Usage:
 *   docker run --rm \
 *     -v /path/to/data:/app/data \
 *     israeli-bank-importer:real-e2e \
 *     node scripts/real-e2e/verify.mjs <budgetId>
 *
 * @param {string} budgetId - Local budget folder name (e.g., real-e2e-1773330306107-e7ccaf4)
 */

import api from '@actual-app/api';

const budgetId = process.argv[2];

if (!budgetId) {
  console.error('Usage: node verify.mjs <budgetId>');
  process.exit(1);
}

try {
  await api.init({ dataDir: '/app/data' });
  await api.loadBudget(budgetId);

  const accounts = await api.getAccounts();
  console.log(`Accounts: ${accounts.length}`);

  if (accounts.length === 0) {
    console.error('FAIL: No accounts found — import did not create any accounts');
    await api.shutdown();
    process.exit(1);
  }

  const result = await api.runQuery(
    api.q('transactions').select(['id', 'imported_id', 'amount', 'date']).limit(10000)
  );
  const transactions = result.data;
  console.log(`Transactions: ${transactions.length}`);

  if (transactions.length === 0) {
    console.error('FAIL: No transactions found — import did not import any transactions');
    await api.shutdown();
    process.exit(1);
  }

  // Summary per account
  for (const account of accounts) {
    const acctResult = await api.runQuery(
      api.q('transactions')
        .filter({ account: account.id })
        .select(['id'])
        .limit(10000)
    );
    console.log(`  ${account.name}: ${acctResult.data.length} transactions`);
  }

  console.log(`\nPASS: ${accounts.length} accounts, ${transactions.length} transactions imported`);
  await api.shutdown();
} catch (error) {
  console.error('Verification failed:', error);
  process.exit(1);
}
