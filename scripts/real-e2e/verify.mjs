/**
 * Verifies that the real E2E import succeeded.
 *
 * Runs inside the importer Docker container (which has @actual-app/api).
 * Connects to the Actual Budget server, loads the budget, and checks
 * that accounts and transactions were created.
 *
 * Usage:
 *   docker run --rm --network real-e2e-net \
 *     -v /path/to/data:/app/data \
 *     israeli-bank-importer:real-e2e \
 *     node scripts/real-e2e/verify.mjs <serverURL> <password> <syncId>
 *
 * @param {string} serverURL - Actual Budget server URL
 * @param {string} password  - Server password
 * @param {string} syncId    - Budget sync ID to verify
 */

import api from '@actual-app/api';

const serverURL = process.argv[2];
const password = process.argv[3];
const syncId = process.argv[4];

if (!serverURL || !password || !syncId) {
  console.error('Usage: node verify.mjs <serverURL> <password> <syncId>');
  process.exit(1);
}

try {
  await api.init({ dataDir: '/app/data', serverURL, password });
  await api.downloadBudget(syncId);

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
