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

async function main(): Promise<void> {
  console.log('=== E2E Setup ===');
  const budgetId = await createTestBudget();
  generateConfig();
  console.log(`Budget ID for E2E_LOCAL_BUDGET_ID: ${budgetId}`);
  console.log('=== Setup complete ===');
}

main().catch(err => {
  console.error('Setup failed:', err);
  process.exit(1);
});
