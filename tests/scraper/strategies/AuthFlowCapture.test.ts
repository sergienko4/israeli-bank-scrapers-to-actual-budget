/**
 * AuthFlowCapture tests — proves the durable long-term token is captured
 * without ever reaching the logs, and only for the banks that mint one.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  attachAuthFlowCapture,
  buildTokenStoreKey,
  captureResultToken,
} from '../../../src/Scraper/Tokens/AuthFlowCapture.js';
import type { IAuthFlowHookTarget } from '../../../src/Scraper/Tokens/AuthFlowCapture.js';
import type { IBankTokenStore } from '../../../src/Scraper/Tokens/BankTokenStore.js';
import type { ILogger } from '../../../src/Logger/ILogger.js';
import { succeed } from '../../../src/Types/Index.js';

const ID_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.onezero-ten-year-id-token.signature';

const logger = {
  info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
} as unknown as ILogger;

/**
 * Builds an in-memory store that records what the capture path persisted.
 * @returns A fake store plus the calls it received.
 */
function makeStore(): IBankTokenStore & { calls: { bankId: string; token: string }[] } {
  const calls: { bankId: string; token: string }[] = [];
  return {
    calls,
    read: (): string => '',
    write: (bankId: string, token: string) => {
      calls.push({ bankId, token });
      return succeed({ written: token.length > 0 });
    },
  };
}

/**
 * Collects every argument passed to any logger method during the test.
 * @returns The concatenated text of all logger calls.
 */
function loggedText(): string {
  const calls = [
    ...vi.mocked(logger.info).mock.calls,
    ...vi.mocked(logger.warn).mock.calls,
    ...vi.mocked(logger.error).mock.calls,
    ...vi.mocked(logger.debug).mock.calls,
  ];
  return JSON.stringify(calls);
}

describe('attachAuthFlowCapture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('attaches the hook for oneZero, which mints a durable token', () => {
    const target: IAuthFlowHookTarget = {};
    const attached = attachAuthFlowCapture(target, {
      bankId: 'oneZero', storeKey: 'oneZero', companyType: 'oneZero', store: makeStore(), logger,
    });
    expect(attached).toBe(true);
    expect(typeof target.onAuthFlowComplete).toBe('function');
  });

  it('attaches the hook for pepper and payBox, which share the API-direct flow', () => {
    const pepper: IAuthFlowHookTarget = {};
    const payBox: IAuthFlowHookTarget = {};
    const store = makeStore();
    attachAuthFlowCapture(pepper, { bankId: 'pepper', storeKey: 'pepper', companyType: 'pepper', store, logger });
    attachAuthFlowCapture(payBox, { bankId: 'payBox', storeKey: 'payBox', companyType: 'payBox', store, logger });
    expect(typeof pepper.onAuthFlowComplete).toBe('function');
    expect(typeof payBox.onAuthFlowComplete).toBe('function');
  });

  it('leaves browser banks untouched, since they never produce a durable token', () => {
    const target: IAuthFlowHookTarget = {};
    const attached = attachAuthFlowCapture(target, {
      bankId: 'hapoalim', storeKey: 'hapoalim', companyType: 'hapoalim', store: makeStore(), logger,
    });
    expect(attached).toBe(false);
    expect(target.onAuthFlowComplete).toBeUndefined();
  });

  it('persists a non-empty long-term token under the bank id', async () => {
    const store = makeStore();
    const target: IAuthFlowHookTarget = {};
    attachAuthFlowCapture(target, { bankId: 'oneZero', storeKey: 'oneZero', companyType: 'oneZero', store, logger });
    await target.onAuthFlowComplete?.({ longTermToken: ID_TOKEN, bearer: 'session-bearer' });
    expect(store.calls).toEqual([{ bankId: 'oneZero', token: ID_TOKEN }]);
  });

  it('ignores an empty long-term token rather than erasing a working one', async () => {
    const store = makeStore();
    const target: IAuthFlowHookTarget = {};
    attachAuthFlowCapture(target, { bankId: 'oneZero', storeKey: 'oneZero', companyType: 'oneZero', store, logger });
    await target.onAuthFlowComplete?.({ longTermToken: '', bearer: 'session-bearer' });
    expect(store.calls).toEqual([]);
  });

  it('warns without failing the scrape when the store cannot be written', async () => {
    const store: IBankTokenStore = {
      read: (): string => '',
      write: () => {
        throw new Error('EROFS: read-only file system');
      },
    };
    const target: IAuthFlowHookTarget = {};
    attachAuthFlowCapture(target, { bankId: 'oneZero', storeKey: 'oneZero', companyType: 'oneZero', store, logger });
    await expect(target.onAuthFlowComplete?.({ longTermToken: ID_TOKEN, bearer: 'b' }))
      .resolves.toBeUndefined();
    expect(vi.mocked(logger.warn)).toHaveBeenCalled();
  });

  it('never writes the token or the bearer to the logs', async () => {
    const target: IAuthFlowHookTarget = {};
    attachAuthFlowCapture(target, {
      bankId: 'oneZero', storeKey: 'oneZero', companyType: 'oneZero', store: makeStore(), logger,
    });
    await target.onAuthFlowComplete?.({ longTermToken: ID_TOKEN, bearer: 'session-bearer' });
    const text = loggedText();
    expect(text).not.toContain(ID_TOKEN);
    expect(text).not.toContain('session-bearer');
  });
});

describe('captureResultToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists a token the result carried but the callback never delivered', () => {
    const store = makeStore();
    captureResultToken(
      { success: true, accounts: [], persistentOtpToken: ID_TOKEN },
      { bankId: 'oneZero', storeKey: 'oneZero', companyType: 'oneZero', store, logger }
    );
    expect(store.calls).toEqual([{ bankId: 'oneZero', token: ID_TOKEN }]);
  });

  it('delegates an unchanged token to the store, which owns deduplication', () => {
    const store = makeStore();
    const stored: IBankTokenStore = { ...store, read: (): string => ID_TOKEN };
    captureResultToken(
      { success: true, accounts: [], persistentOtpToken: ID_TOKEN },
      { bankId: 'oneZero', storeKey: 'oneZero', companyType: 'oneZero', store: stored, logger }
    );
    expect(store.calls).toEqual([{ bankId: 'oneZero', token: ID_TOKEN }]);
  });

  it('skips a write when the result carries no token', () => {
    const store = makeStore();
    captureResultToken(
      { success: true, accounts: [] },
      { bankId: 'oneZero', storeKey: 'oneZero', companyType: 'oneZero', store, logger }
    );
    expect(store.calls).toEqual([]);
  });

  it('persists a token a failed scrape had already minted', () => {
    const store = makeStore();
    captureResultToken(
      { success: false, accounts: [], errorMessage: 'nope', persistentOtpToken: ID_TOKEN },
      { bankId: 'oneZero', storeKey: 'oneZero', companyType: 'oneZero', store, logger }
    );
    expect(store.calls).toEqual([{ bankId: 'oneZero', token: ID_TOKEN }]);
  });

  it('skips a write for a browser bank that cannot warm-start', () => {
    const store = makeStore();
    captureResultToken(
      { success: true, accounts: [], persistentOtpToken: ID_TOKEN },
      { bankId: 'hapoalim', storeKey: 'hapoalim', companyType: 'hapoalim', store, logger }
    );
    expect(store.calls).toEqual([]);
  });
});

/**
 * The registry resolves aliases case-insensitively, so `oneZero` and
 * `onezero` both yield the bankId `onezero`. Keying tokens on the bankId
 * alone would put two real accounts in one slot, where each run replays the
 * other account's token and re-mints — revoking the other on every run.
 */
/**
 * Builds an in-memory store that keeps the last token written per key.
 * @returns A fake store backed by a map.
 */
function makeStatefulStore(): IBankTokenStore {
  const held = new Map<string, string>();
  return {
    read: (storeKey: string): string => held.get(storeKey) ?? '',
    write: (storeKey: string, token: string) => {
      held.set(storeKey, token);
      return succeed({ written: true });
    },
  };
}

describe('a capture from a superseded attempt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Attaches a capture hook for one attempt against a shared store.
   * @param store - Store every attempt writes through.
   * @returns The provider options carrying that attempt's hook.
   */
  function attemptOptions(store: IBankTokenStore): IAuthFlowHookTarget {
    const target: IAuthFlowHookTarget = {};
    attachAuthFlowCapture(target, {
      bankId: 'oneZero', storeKey: 'oneZero', companyType: 'oneZero', store, logger,
    });
    return target;
  }

  it('keeps the token that arrived last, because it was minted last', async () => {
    const store = makeStatefulStore();
    const abandoned = attemptOptions(store);
    const current = attemptOptions(store);
    await current.onAuthFlowComplete?.({ longTermToken: 'minted-second', bearer: '' });
    await abandoned.onAuthFlowComplete?.({ longTermToken: 'minted-third', bearer: '' });
    expect(store.read('oneZero')).toBe('minted-third');
  });

  it('never drops a capture for arriving after another attempt wrote', async () => {
    const store = makeStatefulStore();
    const abandoned = attemptOptions(store);
    const current = attemptOptions(store);
    await current.onAuthFlowComplete?.({ longTermToken: 'minted-second', bearer: '' });
    await abandoned.onAuthFlowComplete?.({ longTermToken: 'minted-third', bearer: '' });
    expect(store.read('oneZero')).not.toBe('minted-second');
  });
});

describe('buildTokenStoreKey', () => {
  it('separates two config entries that resolve to the same bank id', () => {
    const first = buildTokenStoreKey('onezero', 'oneZero');
    const second = buildTokenStoreKey('onezero', 'onezero');

    expect(first).not.toBe(second);
  });

  it('is stable for the same configured account', () => {
    expect(buildTokenStoreKey('onezero', 'oneZero')).toBe(buildTokenStoreKey('onezero', 'oneZero'));
  });

  it('falls back to the bank id when no account name is known', () => {
    expect(buildTokenStoreKey('onezero', undefined)).toBe('onezero');
  });

  it('treats a blank account name as unknown rather than building a dangling key', () => {
    expect(buildTokenStoreKey('onezero', '   ')).toBe('onezero');
  });
});
