import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { WebhookNotifier } from '../../src/services/notifications/WebhookNotifier.js';
import { createTestSummary } from './helpers/testData.js';
import { createWebhookCapture, WebhookCapture } from './helpers/webhookCapture.js';

let capture: WebhookCapture;

beforeAll(async () => {
  capture = createWebhookCapture();
  await capture.start();
});

afterAll(async () => {
  await capture.stop();
});

beforeEach(() => {
  capture.requests.length = 0;
});

describe('Webhook Notifications E2E', () => {
  it('delivers Slack format summary via real HTTP', async () => {
    const notifier = new WebhookNotifier({
      url: `http://localhost:${capture.port}/webhook`,
      format: 'slack',
    });
    await notifier.sendSummary(createTestSummary());

    expect(capture.requests).toHaveLength(1);
    const payload = JSON.parse(capture.requests[0].body);
    expect(payload).toHaveProperty('text');
    expect(payload.text).toContain('Import Summary');
    expect(capture.requests[0].headers['content-type']).toBe('application/json');
  });

  it('delivers Discord format summary via real HTTP', async () => {
    const notifier = new WebhookNotifier({
      url: `http://localhost:${capture.port}/webhook`,
      format: 'discord',
    });
    await notifier.sendSummary(createTestSummary());

    expect(capture.requests).toHaveLength(1);
    const payload = JSON.parse(capture.requests[0].body);
    expect(payload).toHaveProperty('content');
    expect(payload.content).toContain('Import Summary');
  });

  it('delivers plain JSON format with all fields', async () => {
    const notifier = new WebhookNotifier({
      url: `http://localhost:${capture.port}/webhook`,
      format: 'plain',
    });
    await notifier.sendSummary(createTestSummary());

    expect(capture.requests).toHaveLength(1);
    const payload = JSON.parse(capture.requests[0].body);
    expect(payload.event).toBe('import_complete');
    expect(payload.totalBanks).toBe(1);
    expect(payload.successfulBanks).toBe(1);
    expect(payload.totalTransactions).toBe(2);
    expect(payload.banks).toHaveLength(1);
  });

  it('delivers error payload via real HTTP', async () => {
    const notifier = new WebhookNotifier({
      url: `http://localhost:${capture.port}/webhook`,
      format: 'slack',
    });
    await notifier.sendError('E2E test error');

    expect(capture.requests).toHaveLength(1);
    const payload = JSON.parse(capture.requests[0].body);
    expect(payload.text).toContain('Import Failed');
    expect(payload.text).toContain('E2E test error');
  });

  it('delivers spending alert message via real HTTP', async () => {
    const notifier = new WebhookNotifier({
      url: `http://localhost:${capture.port}/webhook`,
      format: 'plain',
    });
    await notifier.sendMessage('Spending alert: over budget');

    expect(capture.requests).toHaveLength(1);
    const payload = JSON.parse(capture.requests[0].body);
    expect(payload.event).toBe('message');
    expect(payload.message).toBe('Spending alert: over budget');
  });
});
