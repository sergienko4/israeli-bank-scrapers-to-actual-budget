import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TimeoutError from '../../src/Errors/TimeoutError.js';
import AppOtpPrompter from '../../src/Services/TwoFactor/AppOtpPrompter.js';
import OtpRequestStore from '../../src/Services/TwoFactor/OtpRequestStore.js';

let dir: string;
let store: OtpRequestStore;

describe('AppOtpPrompter', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'otp-prompter-'));
    store = new OtpRequestStore(join(dir, 'otp-requests.json'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a request, pushes it, and resolves once a code is submitted', async () => {
    const pushed: { bankId: string; requestId: string }[] = [];
    const push = {
      sendOtpRequest: async (bankId: string, requestId: string): Promise<void> => {
        pushed.push({ bankId, requestId });
      },
    };
    const prompter = new AppOtpPrompter(store, push, { defaultTimeoutSeconds: 300, pollIntervalMs: 5 });

    const retrieve = prompter.createOtpRetriever('leumi', 5);
    const codePromise = retrieve();

    // The push fires immediately with the new request id; simulate the app reply.
    await vi.waitFor(() => { expect(pushed).toHaveLength(1); });
    expect(store.submit(pushed[0].requestId, '123456')).toBe(true);

    await expect(codePromise).resolves.toBe('123456');
    // The request is consumed (removed) after the code is returned.
    expect(store.get(pushed[0].requestId)).toBeNull();
  });

  it('throws TimeoutError when no code is submitted before the deadline', async () => {
    const push = { sendOtpRequest: async (): Promise<void> => { /* no-op */ } };
    const prompter = new AppOtpPrompter(store, push, { defaultTimeoutSeconds: 300, pollIntervalMs: 5 });

    const retrieve = prompter.createOtpRetriever('hapoalim', 0.02);
    await expect(retrieve()).rejects.toBeInstanceOf(TimeoutError);
  });

  it('passes the bank id to the push sender', async () => {
    const seen: string[] = [];
    const push = { sendOtpRequest: async (bankId: string): Promise<void> => { seen.push(bankId); } };
    const prompter = new AppOtpPrompter(store, push, { defaultTimeoutSeconds: 300, pollIntervalMs: 5 });

    await expect(prompter.createOtpRetriever('discount', 0.02)()).rejects.toBeInstanceOf(TimeoutError);
    expect(seen).toEqual(['discount']);
  });
});
