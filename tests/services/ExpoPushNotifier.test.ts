import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IImportSummary } from '../../src/Services/MetricsService.js';
import type DeviceTokenStore from '../../src/Services/Notifications/DeviceTokenStore.js';
import ExpoPushNotifier from '../../src/Services/Notifications/ExpoPushNotifier.js';

const realFetch = globalThis.fetch;

/**
 * Builds a DeviceTokenStore stub returning the given tokens.
 * @param tokens - Tokens the stub's list() returns.
 * @returns A store-shaped stub.
 */
function makeStore(tokens: string[]): DeviceTokenStore {
  return { list: () => tokens } as unknown as DeviceTokenStore;
}

/**
 * Builds a minimal import summary for tests.
 * @param failed - Number of failed banks.
 * @returns An IImportSummary.
 */
function summary(failed = 0): IImportSummary {
  return {
    totalBanks: 2,
    successfulBanks: 2 - failed,
    failedBanks: failed,
    totalTransactions: 5,
    totalDuplicates: 0,
    totalDuration: 1000,
    averageDuration: 500,
    successRate: 100,
    banks: [],
  };
}

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('ExpoPushNotifier', () => {
  it('posts a summary to Expo for each registered token', async () => {
    const calls: { url: string; body: string }[] = [];
    globalThis.fetch = vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return Promise.resolve({ ok: true, status: 200 } as Response);
    }) as unknown as typeof fetch;

    await new ExpoPushNotifier(makeStore(['ExponentPushToken[a]'])).sendSummary(summary());
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://exp.host/--/api/v2/push/send');
    expect(calls[0].body).toContain('ExponentPushToken[a]');
    expect(calls[0].body).toContain('Bank import complete');
  });

  it('does not call Expo when there are no tokens', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await new ExpoPushNotifier(makeStore([])).sendSummary(summary(1));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not throw when Expo returns an error status', async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500 } as Response)) as unknown as typeof fetch;
    await expect(new ExpoPushNotifier(makeStore(['t'])).sendSummary(summary(1))).resolves.toBeUndefined();
  });

  it('does not throw when fetch rejects', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('network'))) as unknown as typeof fetch;
    await expect(new ExpoPushNotifier(makeStore(['t'])).sendError('boom')).resolves.toBeUndefined();
  });

  it('sends a plain message', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200 } as Response));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await new ExpoPushNotifier(makeStore(['t'])).sendMessage('hi');
    expect(fetchMock).toHaveBeenCalled();
  });
});
