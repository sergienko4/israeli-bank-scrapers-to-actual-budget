/**
 * Which long-term token an API-direct login is allowed to send.
 *
 * <p>A Pepper or PayBox token logs in by itself, so the token an attempt sends
 * decides which account it imports. The resolver sends a token only when the
 * store vouches that it belongs to this attempt's login: the entry's own
 * stored token first, then the configured seed, and otherwise none, so the
 * provider logs in cold with an SMS. The replay journey through the shipped
 * assembly is `tests/e2e/WarmStartReplay.e2e.test.ts`; this suite pins each
 * branch of the decision. Cases run a real {@link BankTokenStore} over a
 * {@link FakeFileSystem}, except those that need a store which fails.
 */

import { CompanyTypes } from '@sergienko4/israeli-bank-scrapers';
import type { Mock } from 'vitest';
import { describe, expect, it, vi } from 'vitest';

import type { ILogger } from '../../src/Logger/ILogger.js';
import redactSecrets from '../../src/Logger/SecretRedaction.js';
import type { IAuthFlowCaptureParams } from '../../src/Scraper/Tokens/AuthFlowCapture.js';
import { NO_LOGIN } from '../../src/Scraper/Tokens/BankTokenRecords.js';
import type { IBankTokenStore } from '../../src/Scraper/Tokens/BankTokenStore.js';
import resolveWarmToken from '../../src/Scraper/Tokens/WarmTokenResolver.js';
import type { IBankConfig } from '../../src/Types/Index.js';
import { fail } from '../../src/Types/ProcedureHelpers.js';
import { fakeBankConfig, fakeLoginFingerprint } from '../helpers/factories.js';
import {
  ACCOUNT_LOGIN, CAPTURED_AT, fakeToken, makeStore, seedRaw, seedRecords,
} from './BankTokenStoreFixture.js';

/** The key a `oneZero` config entry resolves to. */
const STORE_KEY = 'onezero:oneZero';

/** A login other than the attempt's, as after an email or phone change. */
const OTHER_LOGIN = fakeLoginFingerprint();

/** Logger whose every call a case can inspect. */
type SpyLogger = { readonly [K in keyof ILogger]: Mock<ILogger[K]> };

/** One resolution: the config the attempt logs in with, and what was logged. */
interface IResolved {
  readonly bankConfig: IBankConfig;
  readonly logger: SpyLogger;
}

/** How a case wires one resolution. */
interface IResolveSetup {
  /** The configured `otpLongTermToken`; none unless given. */
  readonly seed?: unknown;
  /** The attempt's login; {@link ACCOUNT_LOGIN} unless given. */
  readonly login?: string;
  /** Whether the attempt can ask for an SMS code; true unless given. */
  readonly canAskForOtp?: boolean;
}

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
 * Builds a config entry carrying a seed of any shape, as a hand-edited file can.
 * @param seed - The `otpLongTermToken` value, or undefined for none.
 * @returns A frozen config entry, so any mutation throws.
 */
function configWith(seed: unknown): IBankConfig {
  const base = fakeBankConfig();
  const entry = seed === undefined ? base : { ...base, otpLongTermToken: seed as string };
  return Object.freeze(entry);
}

/**
 * Resolves the token one OneZero attempt sends, over a given store.
 * @param store - Token store the resolver reads.
 * @param setup - Seed, login and OTP ability for the attempt.
 * @returns The config the attempt logs in with, and the logger.
 */
function resolveOver(store: IBankTokenStore, setup: IResolveSetup = {}): IResolved {
  const logger = spyLogger();
  const params: IAuthFlowCaptureParams = {
    storeKey: STORE_KEY, companyType: CompanyTypes.OneZero,
    login: setup.login ?? ACCOUNT_LOGIN, store, logger,
  };
  const request = { bankConfig: configWith(setup.seed), canAskForOtp: setup.canAskForOtp ?? true };
  return { bankConfig: resolveWarmToken(params, request), logger };
}

/**
 * Serialises every argument a resolution logged, for leak checks.
 * @param logger - Logger the resolution used.
 * @returns All arguments of all calls as one string.
 */
function everythingLogged(logger: SpyLogger): string {
  const calls = [logger.debug, logger.info, logger.warn, logger.error].flatMap((spy) => spy.mock.calls);
  return JSON.stringify(calls);
}

/**
 * Builds a store whose read reports a failure, and counts its reads.
 * @param read - What `read` does.
 * @returns A store that never vouches for a token.
 */
function storeThatReads(read: IBankTokenStore['read']): IBankTokenStore & { readonly read: Mock } {
  return {
    read: vi.fn(read),
    write: vi.fn(),
    sweepStagedLeftovers: vi.fn(),
  };
}

describe('resolveWarmToken', () => {
  describe('with a token stored for the entry', () => {
    it('sends the stored token when the store binds it to this login', () => {
      const { store, fileSystem } = makeStore();
      const stored = fakeToken();
      seedRecords(fileSystem, { [STORE_KEY]: { token: stored, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });

      const { bankConfig } = resolveOver(store);

      expect(bankConfig.otpLongTermToken).toBe(stored);
    });

    it('says at INFO that it uses the stored token, naming the entry but not the token', () => {
      const { store, fileSystem } = makeStore();
      const stored = fakeToken();
      seedRecords(fileSystem, { [STORE_KEY]: { token: stored, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });

      const { logger } = resolveOver(store);

      expect(logger.info).toHaveBeenCalledWith(`  🔐 Using the stored long-term token for ${STORE_KEY}`);
      expect(everythingLogged(logger)).not.toContain(stored);
    });

    it('sends the stored token rather than the configured one', () => {
      const { store, fileSystem } = makeStore();
      const stored = fakeToken();
      seedRecords(fileSystem, { [STORE_KEY]: { token: stored, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });

      const { bankConfig } = resolveOver(store, { seed: fakeToken() });

      expect(bankConfig.otpLongTermToken).toBe(stored);
    });

    it('sends the stored token even when another entry in the file is damaged', () => {
      const { store, fileSystem } = makeStore();
      const stored = fakeToken();
      seedRecords(fileSystem, {
        [STORE_KEY]: { token: stored, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN },
        'pepper:main': { token: fakeToken(), capturedAt: CAPTURED_AT },
      });

      const { bankConfig } = resolveOver(store);

      expect(bankConfig.otpLongTermToken).toBe(stored);
    });

    it('sends no token when the store binds the stored one to another login', () => {
      const { store, fileSystem } = makeStore();
      seedRecords(fileSystem, { [STORE_KEY]: { token: fakeToken(), capturedAt: CAPTURED_AT, login: OTHER_LOGIN } });

      const { bankConfig } = resolveOver(store);

      expect(bankConfig.otpLongTermToken).toBeUndefined();
    });

    it('ignores the configured token when the stored one belongs to another login', () => {
      const { store, fileSystem } = makeStore();
      seedRecords(fileSystem, { [STORE_KEY]: { token: fakeToken(), capturedAt: CAPTURED_AT, login: OTHER_LOGIN } });

      const { bankConfig } = resolveOver(store, { seed: fakeToken() });

      expect(bankConfig.otpLongTermToken).toBeUndefined();
    });

    it('says at INFO that the login changed, so this run logs in with an SMS', () => {
      const { store, fileSystem } = makeStore();
      seedRecords(fileSystem, { [STORE_KEY]: { token: fakeToken(), capturedAt: CAPTURED_AT, login: OTHER_LOGIN } });

      const { logger } = resolveOver(store);

      expect(logger.info).toHaveBeenCalledWith(
        `  🔐 The stored long-term token for ${STORE_KEY} belongs to another login; logging in with an SMS`,
      );
    });
  });

  describe('with only a configured token', () => {
    it('sends the configured token when the store holds nothing', () => {
      const { store } = makeStore();
      const seed = fakeToken();

      const { bankConfig } = resolveOver(store, { seed });

      expect(bankConfig.otpLongTermToken).toBe(seed);
    });

    it('says at INFO that it uses the configured token, naming the entry but not the token', () => {
      const { store } = makeStore();
      const seed = fakeToken();

      const { logger } = resolveOver(store, { seed });

      expect(logger.info).toHaveBeenCalledWith(`  🔐 Using the configured long-term token for ${STORE_KEY}`);
      expect(everythingLogged(logger)).not.toContain(seed);
    });

    it('sends the configured token without the whitespace around it', () => {
      const { store } = makeStore();
      const seed = fakeToken();

      const { bankConfig } = resolveOver(store, { seed: `  ${seed}\n` });

      expect(bankConfig.otpLongTermToken).toBe(seed);
    });

    it('sends a configured token the store binds to this login under another key', () => {
      const { store, fileSystem } = makeStore();
      const seed = fakeToken();
      seedRecords(fileSystem, { 'onezero:old': { token: seed, capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });

      const { bankConfig } = resolveOver(store, { seed });

      expect(bankConfig.otpLongTermToken).toBe(seed);
    });

    const refusedSeeds = [
      {
        why: 'is not text',
        arrange: (): unknown => 12_345,
        warning: `The configured long-term token for ${STORE_KEY} is not text, so it is not sent`,
      },
      {
        why: 'comes with a damaged token file',
        arrange: (fileSystem: Parameters<typeof seedRaw>[0]): unknown => {
          seedRaw(fileSystem, '{ not json');
          return fakeToken();
        },
        warning: `The token file is damaged, so the configured long-term token for ${STORE_KEY} is not sent`,
      },
      {
        why: 'belongs to another login',
        arrange: (fileSystem: Parameters<typeof seedRaw>[0]): unknown => {
          const seed = fakeToken();
          seedRecords(fileSystem, { 'onezero:other': { token: seed, capturedAt: CAPTURED_AT, login: OTHER_LOGIN } });
          return seed;
        },
        warning: `The configured long-term token for ${STORE_KEY} belongs to another login, so it is not sent`,
      },
    ];

    it.each(refusedSeeds)('sends no token, and warns, when the configured one $why', ({ arrange, warning }) => {
      const { store, fileSystem } = makeStore();
      const seed = arrange(fileSystem);

      const { bankConfig, logger } = resolveOver(store, { seed });

      expect(bankConfig.otpLongTermToken).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(`  ⚠️  ${warning}`);
    });
  });

  describe('with nothing to send', () => {
    it.each([undefined, null, '', '   '])('sends no token and logs nothing when the configured one is %j', (seed) => {
      const { store } = makeStore();

      const { bankConfig, logger } = resolveOver(store, { seed });

      expect(bankConfig.otpLongTermToken).toBeUndefined();
      expect(logger.info).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('sends no token, and warns, when the entry has no login to bind one to', () => {
      const { store, fileSystem } = makeStore();
      seedRecords(fileSystem, { [STORE_KEY]: { token: fakeToken(), capturedAt: CAPTURED_AT, login: ACCOUNT_LOGIN } });

      const { bankConfig, logger } = resolveOver(store, { login: NO_LOGIN, seed: fakeToken() });

      expect(bankConfig.otpLongTermToken).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        `  ⚠️  No login identity for ${STORE_KEY}, so no long-term token is sent`,
      );
    });

    it('does not read the store for an entry with no login', () => {
      const store = storeThatReads(() => fail('never asked'));

      resolveOver(store, { login: NO_LOGIN });

      expect(store.read).not.toHaveBeenCalled();
    });

    it('sends no token, and warns with the cause, when the store cannot be read', () => {
      const store = storeThatReads(() => fail('EACCES: permission denied'));

      const { bankConfig, logger } = resolveOver(store, { seed: fakeToken() });

      expect(bankConfig.otpLongTermToken).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        `  ⚠️  Could not read the long-term token for ${STORE_KEY}: EACCES: permission denied`,
      );
    });

    it('sends no token, and warns with the cause, when reading the store throws', () => {
      const store = storeThatReads(() => { throw new Error('disk vanished'); });

      const { bankConfig, logger } = resolveOver(store, { seed: fakeToken() });

      expect(bankConfig.otpLongTermToken).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        `  ⚠️  Could not read the long-term token for ${STORE_KEY}: disk vanished`,
      );
    });
  });

  describe('when the run cannot ask for an SMS code', () => {
    const fix = `No usable long-term token for ${STORE_KEY}, and this run cannot ask for an SMS code: `
      + 'turn on twoFactorAuth for one SMS login, or restore the token file';

    it('warns how to fix a run that has no token to send', () => {
      const { store } = makeStore();

      const { logger } = resolveOver(store, { canAskForOtp: false });

      expect(logger.warn).toHaveBeenCalledWith(`  ⚠️  ${fix}`);
    });

    it('does not warn about the fix when a token is sent', () => {
      const { store } = makeStore();

      const { logger } = resolveOver(store, { seed: fakeToken(), canAskForOtp: false });

      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('does not warn about the fix when the run can ask for an SMS code', () => {
      const { store } = makeStore();

      const { logger } = resolveOver(store, { canAskForOtp: true });

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('what it returns', () => {
    it('leaves the config entry it was given untouched', () => {
      const { store } = makeStore();
      const logger = spyLogger();
      const params: IAuthFlowCaptureParams = {
        storeKey: STORE_KEY, companyType: CompanyTypes.OneZero, login: NO_LOGIN, store, logger,
      };
      const seed = fakeToken();
      const bankConfig = configWith(seed);

      const resolved = resolveWarmToken(params, { bankConfig, canAskForOtp: true });

      expect(resolved).not.toBe(bankConfig);
      expect(bankConfig.otpLongTermToken).toBe(seed);
    });

    it('keeps every other field of the config entry', () => {
      const { store } = makeStore();
      const logger = spyLogger();
      const params: IAuthFlowCaptureParams = {
        storeKey: STORE_KEY, companyType: CompanyTypes.OneZero, login: ACCOUNT_LOGIN, store, logger,
      };
      const bankConfig = configWith(fakeToken());

      const { otpLongTermToken: _sent, ...rest } = resolveWarmToken(params, { bankConfig, canAskForOtp: true });

      const { otpLongTermToken: _configured, ...expected } = bankConfig;
      expect(rest).toEqual(expected);
    });

    it('hides the configured token it sends from every output', () => {
      const { store } = makeStore();
      const seed = fakeToken();

      resolveOver(store, { seed });

      expect(redactSecrets(`provider said ${seed} back`)).not.toContain(seed);
    });
  });
});
