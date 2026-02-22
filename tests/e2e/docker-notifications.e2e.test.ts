/**
 * Docker Notifications E2E Tests
 * - Happy path: webhook receives import summary + spending alerts
 * - Error handling: bad webhook → import still completes, scraper failure → notification
 *
 * Linux-only: requires --network host for Docker→host webhook communication.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import { writeFileSync } from 'fs';
import { createWebhookCapture, WebhookCapture } from './helpers/webhookCapture.js';
import { runImporterDockerAsync, getFixturesDir, findBudgetId, createTempFileTracker, hasDockerImage } from './helpers/dockerRunner.js';
import { createBaseConfig } from './helpers/testData.js';

const FIXTURES = getFixturesDir();
const IS_LINUX = process.platform === 'linux';
const DOCKER_HOST = IS_LINUX ? 'localhost' : 'host.docker.internal';
const HAS_BUDGET = !!findBudgetId();
const temp = createTempFileTracker();

function writeWebhookConfig(webhookUrl: string): string {
  const config = createBaseConfig({
    banks: {
      e2eTestBank: {
        id: 'test', password: 'test', num: '123', daysBack: 30,
        targets: [{ actualAccountId: 'e2e00000-0000-0000-0000-000000000001', reconcile: true, accounts: 'all' }],
      },
    },
    notifications: { enabled: true, webhook: { url: webhookUrl, format: 'plain' } },
    spendingWatch: [{ alertFromAmount: 1, numOfDayToCount: 30 }],
  });
  const path = join(FIXTURES, 'config-webhook-test.json');
  writeFileSync(path, JSON.stringify(config, null, 2));
  temp.track(path);
  return path;
}

let capture: WebhookCapture;
let budgetId: string | null;

beforeAll(async () => {
  budgetId = findBudgetId();
  capture = createWebhookCapture();
  await capture.start();
});

afterAll(async () => {
  await capture.stop();
  temp.cleanup();
});

describe.runIf(HAS_BUDGET && hasDockerImage())('Docker Notifications E2E', () => {
  describe('happy path', () => {
    it('webhook receives import_complete with bank metrics', async () => {
      const configPath = writeWebhookConfig(`http://${DOCKER_HOST}:${capture.port}/webhook`);
      capture.requests.length = 0;

      await runImporterDockerAsync({
        configPath, budgetId: budgetId!,
        mockScraperDir: join(FIXTURES, 'mock-scraper-dir'),
        networkHost: IS_LINUX,
      });

      const summaries = capture.requests
        .map(r => JSON.parse(r.body) as Record<string, unknown>)
        .filter(p => p.event === 'import_complete');

      expect(summaries.length).toBeGreaterThanOrEqual(1);
      expect(summaries[0].totalBanks).toBe(1);
      expect(summaries[0].successfulBanks).toBe(1);
    });

    it('webhook receives spending alert with threshold info', () => {
      const messages = capture.requests
        .map(r => JSON.parse(r.body) as { event?: string; message?: string })
        .filter(p => p.event === 'message');

      expect(messages.length).toBeGreaterThanOrEqual(1);
      expect(messages[0].message).toContain('Spending Watch');
    });
  });

  describe('error handling', () => {
    it('import completes when webhook URL is unreachable', async () => {
      const badUrl = `http://${DOCKER_HOST}:19999/dead`;
      const config = createBaseConfig({
        notifications: { enabled: true, webhook: { url: badUrl, format: 'plain' } },
      });
      const path = join(FIXTURES, 'config-bad-webhook.json');
      writeFileSync(path, JSON.stringify(config, null, 2));
      temp.track(path);

      const result = await runImporterDockerAsync({
        configPath: path, budgetId: budgetId!,
        mockScraperFile: join(FIXTURES, 'mock-scraper-result.json'),
        networkHost: IS_LINUX,
      });

      expect(result.output).toContain('Import process completed');
    });

    it('scraper failure sends notification via webhook', async () => {
      const configPath = writeWebhookConfig(`http://${DOCKER_HOST}:${capture.port}/webhook`);
      capture.requests.length = 0;

      await runImporterDockerAsync({
        configPath, budgetId: budgetId!,
        mockScraperFile: join(FIXTURES, 'mock-scraper-failure.json'),
        networkHost: IS_LINUX,
      });

      const payloads = capture.requests.map(r => JSON.parse(r.body) as Record<string, unknown>);
      const hasNotification = payloads.some(p => p.event === 'import_complete' || p.event === 'error');

      expect(hasNotification).toBe(true);
    });
  });
});
