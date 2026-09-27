import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import StorageError from '../../src/Errors/StorageError.js';
import TimeoutError from '../../src/Errors/TimeoutError.js';
import AppOtpPrompter from '../../src/Services/TwoFactor/AppOtpPrompter.js';
import OtpRequestStore from '../../src/Services/TwoFactor/OtpRequestStore.js';
import createNodeFileSystem from '../../src/Storage/NodeFileSystem.js';
import FakeFileSystem from '../storage/FakeFileSystem.js';

let dir: string;
let store: OtpRequestStore;

/** A push sender that records every prompt it is asked to send. */
interface IRecordingPush {
  readonly pushed: { bankId: string; requestId: string }[];
  sendOtpRequest(bankId: string, requestId: string): Promise<void>;
}

/**
 * Builds a push sender that records what it sends.
 * @returns The recording sender.
 */
function recordingPush(): IRecordingPush {
  const pushed: { bankId: string; requestId: string }[] = [];
  return {
    pushed,
    sendOtpRequest: async (bankId: string, requestId: string): Promise<void> => {
      pushed.push({ bankId, requestId });
    },
  };
}

/**
 * Reads every file left in the directory.
 * @returns The contents of each file.
 */
function contentsLeft(): string[] {
  return readdirSync(dir).map((name) => readFileSync(join(dir, name), 'utf8'));
}

describe('AppOtpPrompter', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'otp-prompter-'));
    store = new OtpRequestStore(createNodeFileSystem(), join(dir, 'otp-requests.json'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a request, pushes it, and resolves once a code is submitted', async () => {
    const push = recordingPush();
    const prompter = new AppOtpPrompter(store, push, { defaultTimeoutSeconds: 300, pollIntervalMs: 5 });

    const codePromise = prompter.createOtpRetriever('leumi', 5)();

    await vi.waitFor(() => { expect(push.pushed).toHaveLength(1); });
    expect(store.pending().map((request) => request.id)).toEqual([push.pushed[0].requestId]);
    expect(store.submit(push.pushed[0].requestId, '123456')).toBe(true);

    await expect(codePromise).resolves.toBe('123456');
    expect(store.pending()).toEqual([]);
    expect(contentsLeft().filter((text) => text.includes('123456'))).toEqual([]);
    expect(store.submit(push.pushed[0].requestId, '654321')).toBe(false);
  });

  it('throws TimeoutError when no code is submitted before the deadline, refusing a later one', async () => {
    const push = recordingPush();
    const prompter = new AppOtpPrompter(store, push, { defaultTimeoutSeconds: 300, pollIntervalMs: 5 });

    await expect(prompter.createOtpRetriever('hapoalim', 0.02)()).rejects.toBeInstanceOf(TimeoutError);
    expect(store.pending()).toEqual([]);
    expect(store.submit(push.pushed[0].requestId, '123456')).toBe(false);
  });

  it('passes the bank id to the push sender', async () => {
    const push = recordingPush();
    const prompter = new AppOtpPrompter(store, push, { defaultTimeoutSeconds: 300, pollIntervalMs: 5 });

    await expect(prompter.createOtpRetriever('discount', 0.02)()).rejects.toBeInstanceOf(TimeoutError);
    expect(push.pushed.map((sent) => sent.bankId)).toEqual(['discount']);
  });

  it('reports a failure to record the expiry as a storage failure, not a timeout', async () => {
    const fileSystem = new FakeFileSystem();
    fileSystem.seedDirectory('/data');
    fileSystem.failOnCall('publishExclusive', 2, 'EPERM');
    const failing = new OtpRequestStore(fileSystem, '/data/otp-requests.json');
    const prompter = new AppOtpPrompter(failing, recordingPush(), { pollIntervalMs: 5 });

    await expect(prompter.createOtpRetriever('leumi', 0.02)()).rejects.toBeInstanceOf(StorageError);
    expect(failing.pending()).toEqual([]);
  });

  it('reports an answer it cannot read at the deadline as a storage failure, not a timeout', async () => {
    // A timeout would make FallbackOtpPrompter reroute the OTP to Telegram,
    // although the unreadable answer may hold the code the user submitted.
    const fileSystem = new FakeFileSystem();
    fileSystem.seedDirectory('/data');
    const failing = new OtpRequestStore(fileSystem, '/data/otp-requests.json');
    const answerThenLockOut = {
      sendOtpRequest: async (_bankId: string, requestId: string): Promise<void> => {
        failing.submit(requestId, '123456');
        fileSystem.forcedFailures.set('openForRead', 'EACCES');
      },
    };
    const prompter = new AppOtpPrompter(failing, answerThenLockOut, { pollIntervalMs: 5 });

    await expect(prompter.createOtpRetriever('leumi', 0.02)()).rejects.toBeInstanceOf(StorageError);
  });

  it('never pushes a prompt for a request it could not save', async () => {
    const fileSystem = new FakeFileSystem();
    fileSystem.seedDirectory('/data');
    fileSystem.forcedFailures.set('publishExclusive', 'EXDEV');
    const push = recordingPush();
    const prompter = new AppOtpPrompter(new OtpRequestStore(fileSystem, '/data/otp-requests.json'), push);

    await expect(prompter.createOtpRetriever('leumi', 5)()).rejects.toThrow(/EXDEV/);
    expect(push.pushed).toEqual([]);
  });
});
