/**
 * Edge cases for capturing the long-term tokens API-direct banks mint.
 *
 * <p>The end-to-end journey through the live strategy is covered by
 * `tests/e2e/WarmStartCapture.e2e.test.ts`. This suite pins what that
 * journey cannot isolate: which banks are eligible, how the key is built,
 * and that a failing store costs a warning rather than the scrape. Cases run
 * a real {@link BankTokenStore} over a {@link FakeFileSystem}, except those
 * that need a store which throws.
 */

import { CompanyTypes } from '@sergienko4/israeli-bank-scrapers';
import type { IScraperScrapingResult } from '@sergienko4/israeli-bank-scrapers';
import type { Mock } from 'vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ILogger } from '../../src/Logger/ILogger.js';
import type { IAuthFlowCaptureParams, IAuthFlowHookTarget } from '../../src/Scraper/Tokens/AuthFlowCapture.js';
import {
  attachAuthFlowCapture,
  buildTokenStoreKey,
  captureResultToken,
  sweepTokenLeftovers,
} from '../../src/Scraper/Tokens/AuthFlowCapture.js';
import type { IBankTokenStore } from '../../src/Scraper/Tokens/BankTokenStore.js';
import { STALE_STAGING_AGE_MS } from '../../src/Storage/SecureJsonStore.js';
import { NO_LOGIN } from '../../src/Scraper/Tokens/BankTokenRecords.js';
import { fakeLoginFingerprint, fakeUuid } from '../helpers/factories.js';
import {
  ACCOUNT_LOGIN, CAPTURED_AT, fakeToken, makeStore, seedRecords, STORE_PATH, storedRecords,
} from './BankTokenStoreFixture.js';

/** The key a `oneZero` config entry resolves to. */
const STORE_KEY = 'onezero:oneZero';

/** Logger whose every call a case can inspect. */
type SpyLogger = { readonly [K in keyof ILogger]: Mock<ILogger[K]> };

/**
 * Builds a logger that records every call.
 * @returns A logger of spies.
 */
function spyLogger(): SpyLogger {
  return {
    debug: vi.fn<ILogger['debug']>(), info: vi.fn<ILogger['info']>(),
    warn: vi.fn<ILogger['warn']>(), error: vi.fn<ILogger['error']>(),
  };
}

/**
 * Builds capture parameters for one bank over a given store.
 * @param store - Token store the capture writes to.
 * @param companyType - Provider company the scrape is for.
 * @returns Parameters plus the logger they report through.
 */
function captureFor(
  store: IBankTokenStore, companyType: string = CompanyTypes.OneZero,
): IAuthFlowCaptureParams & { readonly logger: SpyLogger } {
  const logger = spyLogger();
  return { storeKey: STORE_KEY, companyType, login: ACCOUNT_LOGIN, store, logger };
}

/**
 * Attaches the capture and returns the callback the provider would invoke.
 * @param params - Capture parameters for the bank under test.
 * @returns The attached callback.
 */
function attachedHook(
  params: IAuthFlowCaptureParams,
): NonNullable<IAuthFlowHookTarget['onAuthFlowComplete']> {
  const target: IAuthFlowHookTarget = {};
  attachAuthFlowCapture(target, params);
  const hook = target.onAuthFlowComplete;
  if (!hook) throw new Error('no auth-flow callback was attached');
  return hook;
}

/**
 * Builds a store whose every operation throws, as a broken adapter might.
 * @returns A store that never returns.
 */
function throwingStore(): IBankTokenStore {
  /**
   * Fails the way an unexpected adapter bug would.
   * @returns Never returns.
   */
  const explode = (): never => {
    throw new Error('EIO: i/o error');
  };
  return { read: explode, write: explode, sweepStagedLeftovers: explode };
}

/**
 * Serialises every argument a logger received, for leak checks.
 * @param logger - Logger to inspect.
 * @returns All arguments of all calls as one string.
 */
function everythingLogged(logger: SpyLogger): string {
  const calls = [logger.debug, logger.info, logger.warn, logger.error]
    .flatMap((spy) => spy.mock.calls);
  return JSON.stringify(calls);
}

/**
 * Builds a provider result carrying a durable token.
 * @param token - Token the provider attached.
 * @param success - Whether the scrape itself succeeded.
 * @returns A provider result.
 */
function resultWith(token: string | undefined, success = true): IScraperScrapingResult {
  return { success, accounts: [], persistentOtpToken: token };
}

describe('buildTokenStoreKey', () => {
  it('joins the canonical bank id and the config entry name', () => {
    expect(buildTokenStoreKey('onezero', 'oneZero')).toBe(STORE_KEY);
  });

  it.each([undefined, '', '   '])('falls back to the bank id when the entry name is %j', (key) => {
    expect(buildTokenStoreKey('onezero', key)).toBe('onezero');
  });

  it('keeps entries that differ only by padding apart', () => {
    const padded = buildTokenStoreKey('onezero', 'oneZero ');
    expect(padded).toBe('onezero:oneZero ');
    expect(padded).not.toBe(buildTokenStoreKey('onezero', 'oneZero'));
  });
});

describe('attachAuthFlowCapture', () => {
  it.each([CompanyTypes.OneZero, CompanyTypes.Pepper, CompanyTypes.PayBox])(
    'stores the token %s hands back',
    async (companyType) => {
      const { store, fileSystem } = makeStore();
      const token = fakeToken();
      await attachedHook(captureFor(store, companyType))({ longTermToken: token, bearer: 'b' });
      expect(storedRecords(fileSystem)).toMatchObject({ [STORE_KEY]: { token } });
    },
  );

  it('binds the stored token to the login of the attempt', async () => {
    const { store, fileSystem } = makeStore();
    const token = fakeToken();
    await attachedHook(captureFor(store))({ longTermToken: token, bearer: 'b' });
    expect(storedRecords(fileSystem)).toMatchObject({ [STORE_KEY]: { token, login: ACCOUNT_LOGIN } });
  });

  it('warns, naming the account, when the file binds the token to another login', async () => {
    const { store, fileSystem } = makeStore();
    const token = fakeToken();
    seedRecords(fileSystem, { 'onezero:other': { token, capturedAt: CAPTURED_AT, login: fakeLoginFingerprint() } });
    const params = captureFor(store);
    await attachedHook(params)({ longTermToken: token, bearer: 'b' });
    expect(String(params.logger.warn.mock.calls[0]?.[0]))
      .toContain(`Could not store the long-term token for ${STORE_KEY}: the token file binds it to another login`);
    expect(storedRecords(fileSystem)).not.toHaveProperty(STORE_KEY);
    expect(everythingLogged(params.logger)).not.toContain(token);
  });

  it('warns, and stores nothing, when the attempt has no login to bind to', async () => {
    const { store, fileSystem } = makeStore();
    const params = { ...captureFor(store), login: NO_LOGIN };
    await attachedHook(params)({ longTermToken: fakeToken(), bearer: 'b' });
    expect(String(params.logger.warn.mock.calls[0]?.[0])).toContain('there is no login to bind it to');
    expect(fileSystem.hasEntry(STORE_PATH)).toBe(false);
  });

  it('leaves browser banks without a callback', () => {
    const { store } = makeStore();
    const target: IAuthFlowHookTarget = {};
    const isAttached = attachAuthFlowCapture(target, captureFor(store, CompanyTypes.Discount));
    expect(isAttached).toBe(false);
    expect(target.onAuthFlowComplete).toBeUndefined();
  });

  it('writes nothing for a blank token', async () => {
    const { store, fileSystem } = makeStore();
    const params = captureFor(store);
    await attachedHook(params)({ longTermToken: '  ', bearer: 'b' });
    expect(fileSystem.hasEntry(STORE_PATH)).toBe(false);
    expect(params.logger.info).not.toHaveBeenCalled();
  });

  it('warns with the cause when the store refuses the write', async () => {
    const { store, fileSystem } = makeStore();
    fileSystem.forcedFailures.set('createExclusive', 'EROFS');
    const params = captureFor(store);
    await attachedHook(params)({ longTermToken: fakeToken(), bearer: 'b' });
    expect(params.logger.warn).toHaveBeenCalledOnce();
    const warning = String(params.logger.warn.mock.calls[0]?.[0]);
    expect(warning).toContain(STORE_KEY);
    expect(warning).toContain('forced createExclusive failure');
  });

  it('warns rather than rejects when the store throws', async () => {
    const params = captureFor(throwingStore());
    const hook = attachedHook(params);
    await expect(hook({ longTermToken: fakeToken(), bearer: 'b' })).resolves.toBeUndefined();
    expect(String(params.logger.warn.mock.calls[0]?.[0])).toContain('EIO: i/o error');
  });

  it('never logs the token or the bearer, stored or refused', async () => {
    const token = fakeToken();
    const bearer = `bearer-${fakeUuid()}`;
    const stored = captureFor(makeStore().store);
    const refused = makeStore();
    refused.fileSystem.forcedFailures.set('createExclusive', 'ENOSPC');
    const failed = captureFor(refused.store);
    await attachedHook(stored)({ longTermToken: token, bearer });
    await attachedHook(failed)({ longTermToken: token, bearer });
    const logged = everythingLogged(stored.logger) + everythingLogged(failed.logger);
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(bearer);
  });
});

describe('captureResultToken', () => {
  it('keeps a token even when the scrape failed after minting it', () => {
    const { store, fileSystem } = makeStore();
    const token = fakeToken();
    const isStored = captureResultToken(resultWith(token, false), captureFor(store));
    expect(isStored).toBe(true);
    expect(storedRecords(fileSystem)).toMatchObject({ [STORE_KEY]: { token, login: ACCOUNT_LOGIN } });
  });

  it('does nothing when the result carries no token', () => {
    const { store, fileSystem } = makeStore();
    expect(captureResultToken(resultWith(undefined), captureFor(store))).toBe(false);
    expect(fileSystem.calls).not.toContain('createExclusive');
  });

  it('ignores a token on a browser bank result', () => {
    const { store, fileSystem } = makeStore();
    const params = captureFor(store, CompanyTypes.Discount);
    expect(captureResultToken(resultWith(fakeToken()), params)).toBe(false);
    expect(fileSystem.hasEntry(STORE_PATH)).toBe(false);
  });

  it('stays quiet when the callback already stored the same token', async () => {
    const { store } = makeStore();
    const params = captureFor(store);
    const token = fakeToken();
    await attachedHook(params)({ longTermToken: token, bearer: 'b' });
    expect(captureResultToken(resultWith(token), params)).toBe(false);
    expect(params.logger.info).toHaveBeenCalledOnce();
  });
});

describe('sweepTokenLeftovers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes a staged token file an earlier run abandoned', () => {
    const { store, fileSystem } = makeStore();
    const abandoned = `${STORE_PATH}.${fakeUuid()}.tmp`;
    fileSystem.seedFile(abandoned, '{}', 0o600);
    fileSystem.setModifiedAt(abandoned, Date.now() - STALE_STAGING_AGE_MS - 1);
    const params = captureFor(store);
    expect(sweepTokenLeftovers(params)).toBe(true);
    expect(fileSystem.hasEntry(abandoned)).toBe(false);
    expect(String(params.logger.info.mock.calls[0]?.[0])).toContain('beside the token store');
  });

  it('stays quiet when there is nothing to sweep', () => {
    const { store } = makeStore();
    const params = captureFor(store);
    expect(sweepTokenLeftovers(params)).toBe(true);
    expect(params.logger.info).not.toHaveBeenCalled();
  });

  it('does not touch the store for a browser bank', () => {
    const { store, fileSystem } = makeStore();
    expect(sweepTokenLeftovers(captureFor(store, CompanyTypes.Discount))).toBe(false);
    expect(fileSystem.calls).toHaveLength(0);
  });

  it('warns with the cause when the directory cannot be listed', () => {
    const { store, fileSystem } = makeStore();
    fileSystem.forcedFailures.set('listNames', 'EACCES');
    const params = captureFor(store);
    expect(sweepTokenLeftovers(params)).toBe(false);
    expect(String(params.logger.warn.mock.calls[0]?.[0])).toContain('forced listNames failure');
  });

  it('warns rather than throws when the store throws', () => {
    const params = captureFor(throwingStore());
    expect(sweepTokenLeftovers(params)).toBe(false);
    expect(String(params.logger.warn.mock.calls[0]?.[0])).toContain('EIO: i/o error');
  });
});
