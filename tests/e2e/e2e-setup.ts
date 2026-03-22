/**
 * E2E Setup Script
 * Creates a local test budget in the shared data volume.
 * Run this before starting the importer container.
 *
 * The budget is created locally (no server sync needed).
 * The importer container loads it via E2E_LOCAL_BUDGET_ID env var.
 */

import api from '@actual-app/api';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(import.meta.dirname, 'fixtures', 'e2e-data');
const CONFIG_TEMPLATE = join(import.meta.dirname, 'fixtures', 'config.e2e.json');
const CONFIG_OUTPUT = join(import.meta.dirname, 'fixtures', 'config.generated.json');

async function createTestBudget(): Promise<string> {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  await api.init({ dataDir: DATA_DIR });

  console.log('Creating test budget...');
  await api.runImport('e2e-test-budget', () => {});

  const budgets = await api.getBudgets();
  const budget = budgets[0];
  if (!budget) throw new Error('No budgets found after creation');

  console.log(`Budget created: ${budget.id}`);
  await api.shutdown();
  return budget.id;
}

function generateConfig(): void {
  const template = JSON.parse(readFileSync(CONFIG_TEMPLATE, 'utf8'));

  addTelegramConfig(template);
  addWebhookConfig(template);

  writeFileSync(CONFIG_OUTPUT, JSON.stringify(template, null, 2));
  console.log(`Config written to ${CONFIG_OUTPUT}`);
}

function addTelegramConfig(template: Record<string, unknown>): void {
  const token = process.env.E2E_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.E2E_TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  const notifications = template.notifications as Record<string, unknown>;
  notifications.telegram = {
    botToken: token, chatId,
    messageFormat: 'compact', showTransactions: 'new',
  };
}

function addWebhookConfig(template: Record<string, unknown>): void {
  const webhookUrl = process.env.E2E_WEBHOOK_URL;
  if (!webhookUrl) return;
  const notifications = template.notifications as Record<string, unknown>;
  notifications.webhook = { url: webhookUrl, format: 'plain' };
}

/**
 * Rewrites mock scraper JSON files so transaction dates are recent (within daysBack window).
 * Prevents date-expiry failures when hardcoded dates age past the filter window.
 */
function refreshMockDates(): void {
  const mockDir = join(import.meta.dirname, 'fixtures', 'mock-scraper-dir');
  if (!existsSync(mockDir)) mkdirSync(mockDir, { recursive: true });

  const sourceFiles = [
    { src: 'mock-scraper-result.json', dest: 'e2eTestBank.json' },
    { src: 'mock-scraper-result-bank2.json', dest: 'e2eTestBank2.json' },
  ];

  for (const { src, dest } of sourceFiles) {
    const srcPath = join(import.meta.dirname, 'fixtures', src);
    if (!existsSync(srcPath)) continue;
    const data = JSON.parse(readFileSync(srcPath, 'utf8'));
    let dayOffset = 3;
    for (const account of data.accounts ?? []) {
      for (const txn of account.txns ?? []) {
        const recent = new Date(Date.now() - dayOffset * 24 * 60 * 60 * 1000);
        txn.date = recent.toISOString().split('T')[0] + 'T00:00:00.000Z';
        dayOffset++;
      }
    }
    writeFileSync(join(mockDir, dest), JSON.stringify(data, null, 2));
    // Also overwrite the source file so standalone mockScraperFile uses get fresh dates
    writeFileSync(srcPath, JSON.stringify(data, null, 2));
  }
  console.log('Mock scraper dates refreshed to recent');
}

async function main(): Promise<void> {
  console.log('=== E2E Setup ===');
  const budgetId = await createTestBudget();
  generateConfig();
  refreshMockDates();
  console.log(`Budget ID for E2E_LOCAL_BUDGET_ID: ${budgetId}`);
  console.log('=== Setup complete ===');
}

main().catch(err => {
  console.error('Setup failed:', err);
  process.exit(1);
});
